import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetParameterCommand, GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createHash, createHmac, randomUUID } from 'node:crypto';

const REGION = process.env.AWS_REGION || 'us-east-1';
const CACHE_TABLE_NAME = process.env.DASHBOARD_CACHE_TABLE_NAME || 'ulttra-crm-dashboard-cache';
const METRICS_TABLE_NAME = process.env.DASHBOARD_METRICS_TABLE_NAME || 'ulttra-crm-dashboard-metrics';
const AUDIT_TABLE_NAME = process.env.AUDIT_TABLE_NAME || 'presttige-review-audit';
const CACHE_KEY = process.env.DASHBOARD_CACHE_KEY || 'presttige-dashboard-v1';
const CACHE_TTL_SECONDS = Number(process.env.DASHBOARD_CACHE_TTL_SECONDS || 300);
const STRIPE_SECRET_PARAMETER = process.env.STRIPE_SECRET_PARAMETER || '/presttige/stripe/secret-key';
const GA_CLIENT_SECRET_PARAMETER = process.env.GA4_OAUTH_CLIENT_SECRET_PARAMETER || '/ulttra/ga/oauth-client-secret';
const GA_REFRESH_TOKEN_PARAMETER = process.env.GA4_OAUTH_REFRESH_TOKEN_PARAMETER || '/ulttra/ga/oauth-refresh-token';
const GA_CLIENT_ID = process.env.GA4_OAUTH_CLIENT_ID || '430778007708-uerfhfgt42k4qfbgcobb9f0cpqi6om9e.apps.googleusercontent.com';
const GA_PROPERTY_ID = process.env.GA4_PROPERTY_ID || '530348665';
const GA_ANALYTICS_WINDOW_DAYS = Number(process.env.GA4_ANALYTICS_WINDOW_DAYS || 30);
const GA_RANK_LIMIT = Number(process.env.GA4_RANK_LIMIT || 5);
const FOUNDER_GLOBAL_CAP_PARAMETER = process.env.FOUNDER_GLOBAL_CAP_PARAMETER || '/presttige/founder-invite/global-cap';
const FOUNDER_ADMIN_FUNCTION_NAME = process.env.FOUNDER_ADMIN_FUNCTION_NAME || 'presttige-founder-admin';
const COMMITTEE_EMAIL_FROM = process.env.COMMITTEE_EMAIL_FROM || 'committee@presttige.net';
const EXPRESS_INTEREST_URL = process.env.EXPRESS_INTEREST_URL || 'https://presttige.net/?presttige_invited=1#express-interest';
const GLOBAL_PROJECT_KEY = 'global';
const PRESTTIGE_PROJECT_KEY = 'presttige';
const CHAIRMAN_EMAIL = 'apereira@presttige.net';
const CHAIRMAN_TYPE = 'chairman';

const memberTiers = ['club', 'premier', 'patron', 'founder'];
const priorityMemberTiers = ['founder', 'patron'];
const dashboardStandards = Object.freeze({
  chairman: Object.freeze({
    type: 'chairman',
    revenue_scope: 'global',
    panels: Object.freeze(['members', 'tiers', 'founders', 'leads', 'revenue', 'website', 'founder_invitation']),
    permissions: Object.freeze({
      dashboard_read: true,
      founder_invite: true,
      other_dashboard_writes: false,
    }),
  }),
  admin: Object.freeze({
    type: 'admin',
    revenue_scope: 'global',
    panels: Object.freeze(['members', 'tiers', 'founders', 'leads', 'revenue', 'website', 'founder_invitation']),
    permissions: Object.freeze({
      dashboard_read: true,
      founder_invite: true,
      other_dashboard_writes: false,
    }),
  }),
  team: Object.freeze({
    type: 'team',
    revenue_scope: 'own_attributed',
    panels: Object.freeze(['members', 'tiers', 'founders', 'leads', 'revenue', 'website', 'founder_invitation']),
    permissions: Object.freeze({
      dashboard_read: true,
      founder_invite: true,
      other_dashboard_writes: false,
    }),
  }),
  consultant: Object.freeze({
    type: 'consultant',
    revenue_scope: 'own_attributed',
    panels: Object.freeze(['members', 'tiers', 'founders', 'leads', 'revenue', 'website', 'founder_invitation']),
    permissions: Object.freeze({
      dashboard_read: true,
      founder_invite: true,
      other_dashboard_writes: false,
    }),
  }),
});
const dashboardStandardStubs = Object.freeze({
  ambassador: Object.freeze({ status: 'stub_only' }),
  business_partner: Object.freeze({ status: 'stub_only' }),
  influencer: Object.freeze({ status: 'stub_only' }),
});
const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient);
const ssm = new SSMClient({ region: REGION });
const lambda = new LambdaClient({ region: REGION });
let cachedAwsCredentials = null;

export default {
  id: 'ulttra-dashboard',
  handler(router, context) {
    router.get('/', async (req, res) => {
      try {
        const user = await requireDashboardUser(req, context);
        const forceRefresh = String(req.query?.refresh || '').toLowerCase() === 'true';
        const standard = getDashboardStandard(user);
        const projects = await readDashboardProjects(context);
        const selectedProjectKey = normalizeProjectKey(req.query?.project || GLOBAL_PROJECT_KEY) || GLOBAL_PROJECT_KEY;
        const dashboard = await getProjectDashboard(user, standard, forceRefresh, selectedProjectKey, projects);
        const chairman = isChairman(user);
        const eligibleInviter = chairman || await isInternalInviterEligible(user.email);
        res.json({
          ok: true,
          project_tabs: projectTabs(projects),
          selected_project: dashboard.project?.key || GLOBAL_PROJECT_KEY,
          current_user: {
            id: user.id,
            email: user.email,
            role: user.role_name,
            standard: standard.type,
            person_id: user.person?.id || null,
            is_chairman: chairman,
            eligible_inviter: eligibleInviter,
          },
          standard: standardResponse(standard),
          ...dashboard,
        });
      } catch (error) {
        sendError(res, error);
      }
    });

    router.post('/founder-invite', async (req, res) => {
      try {
        const user = await requireDashboardUser(req, context);
        const standard = getDashboardStandard(user);
        const invitedEmail = normalizeEmail(req.body?.invited_email);
        const invitedName = normalizeString(req.body?.invited_name);
        if (!isValidEmail(invitedEmail)) {
          res.status(400).json({ ok: false, message: 'Invitation could not be created.' });
          return;
        }
        if (!standard.permissions.founder_invite) {
          res.status(200).json({ ok: false, message: 'Invitation could not be created.' });
          return;
        }
        if (!user.person || isSynthetic(user.person.synthetic_test)) {
          res.status(200).json({ ok: false, message: 'Invitation could not be created.' });
          return;
        }

        const result = await invokeFounderAdmin({
          actorId: `directus:${user.id}`,
          actorEmail: user.email,
          inviterEmail: user.email,
          invitedEmail,
          invitedName,
        });
        const outcome = await founderInviteOutcome(result, invitedEmail);
        res.status(200).json(outcome);
      } catch (error) {
        sendError(res, error);
      }
    });

    router.post('/presttige-invite', async (req, res) => {
      try {
        const user = await requireDashboardUser(req, context);
        const invitedEmail = normalizeEmail(req.body?.invited_email);
        if (!isChairman(user) || !isValidEmail(invitedEmail)) {
          res.status(200).json({
            ok: false,
            status: 'ERROR',
            message: 'Presttige invitation could not be sent.',
          });
          return;
        }

        const timestamp = new Date().toISOString();
        const auditItem = buildPresttigeInvitationAuditItem({
          user,
          invitedEmail,
          timestamp,
        });
        await ddb.send(new PutCommand({
          TableName: AUDIT_TABLE_NAME,
          Item: auditItem,
          ConditionExpression: 'attribute_not_exists(audit_id)',
        }));

        const emailResult = await sendPresttigeInvitationEmail(invitedEmail);
        res.status(200).json({
          ok: true,
          status: 'SENT',
          invitee_email: invitedEmail,
          message: `Presttige invitation sent to ${invitedEmail}.`,
          message_id: emailResult.MessageId || null,
          invitation_id: auditItem.invitation_id,
        });
      } catch (error) {
        sendError(res, error);
      }
    });
  },
};

async function requireDashboardUser(req, context) {
  const userId = req.accountability?.user;
  if (!userId) {
    throw httpError(401, 'Authentication is required.');
  }

  const row = await context.database('directus_users')
    .leftJoin('directus_roles', 'directus_users.role', 'directus_roles.id')
    .select(
      'directus_users.id',
      'directus_users.email',
      'directus_users.status',
      'directus_roles.name as role_name',
    )
    .where('directus_users.id', userId)
    .first();

  if (!row || row.status !== 'active') {
    throw httpError(403, 'Dashboard is available to Admin and Team users.');
  }

  const person = await context.database('people')
    .select('id', 'email', 'type', 'status', 'synthetic_test')
    .whereRaw('lower(email) = ?', [normalizeEmail(row.email)])
    .first();

  const user = {
    id: row.id,
    email: normalizeEmail(row.email),
    role_name: row.role_name,
    person: person || null,
  };
  getDashboardStandard(user);
  return user;
}

async function readDashboardProjects(context) {
  const rows = await context.database('projects')
    .select(
      'id',
      'name',
      'key',
      'display_name',
      'active',
      'ga4_property_id',
      'stripe_account_or_tag',
      'status',
    )
    .orderBy('id', 'asc');

  return rows
    .map((row) => {
      const key = normalizeProjectKey(row.key || row.name);
      const displayName = normalizeString(row.display_name || row.name);
      const active = row.active === true || row.active === 1;
      return {
        id: row.id,
        key,
        display_name: displayName,
        active,
        ga4_property_id: normalizeString(row.ga4_property_id) || null,
        stripe_account_or_tag: normalizeString(row.stripe_account_or_tag) || null,
        status: normalizeString(row.status),
        data_status: hasProjectData({ key, active, stripe_account_or_tag: row.stripe_account_or_tag }) ? 'live' : 'not_configured',
      };
    })
    .filter((project) => project.key && project.display_name);
}

function projectTabs(projects) {
  return [
    {
      key: GLOBAL_PROJECT_KEY,
      display_name: 'Global',
      active: true,
      data_status: 'aggregate',
    },
    ...projects.map((project) => ({
      key: project.key,
      display_name: project.display_name,
      active: project.active,
      data_status: project.data_status,
    })),
  ];
}

async function getProjectDashboard(user, standard, forceRefresh, projectKey, projects) {
  if (projectKey === GLOBAL_PROJECT_KEY) {
    const activeProjectsWithData = projects.filter((project) => project.active && hasProjectData(project));
    if (!activeProjectsWithData.length) {
      return emptyProjectDashboard({
        key: GLOBAL_PROJECT_KEY,
        display_name: 'Global',
        active: true,
        data_status: 'aggregate',
      }, standard, 'No active project data is configured yet.');
    }
    const dashboards = await Promise.all(activeProjectsWithData
      .map((project) => getDashboard(user, standard, forceRefresh, project)));
    return aggregateProjectDashboards(dashboards, standard, activeProjectsWithData);
  }

  const project = projects.find((item) => item.key === projectKey);
  if (!project) {
    return emptyProjectDashboard({
      key: projectKey,
      display_name: 'Project',
      active: false,
      data_status: 'not_configured',
    }, standard, 'Project is not registered yet.');
  }

  if (!hasProjectData(project)) {
    return emptyProjectDashboard(project, standard, `${project.display_name} has no data yet.`);
  }

  return getDashboard(user, standard, forceRefresh, project);
}

async function getDashboard(user, standard, forceRefresh, project = null) {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const revenueScope = getRevenueScope(user, standard);
  const projectKey = project?.key || PRESTTIGE_PROJECT_KEY;
  const cacheKey = `${CACHE_KEY}#project#${projectKey}#${revenueScope.cache_key}`;
  if (!forceRefresh) {
    const cached = await ddb.send(new GetCommand({
      TableName: CACHE_TABLE_NAME,
      Key: { cache_key: cacheKey },
    }));
    const item = cached.Item;
    if (item?.expires_at_epoch && item.expires_at_epoch > nowEpoch && item.payload) {
      return {
        ...item.payload,
        project: projectResponse(project),
        cache: {
          ...item.payload.cache,
          status: 'hit',
        },
      };
    }
  }

  const payload = await computeDashboard(user, standard, revenueScope);
  payload.project = projectResponse(project);
  const expiresAt = nowEpoch + CACHE_TTL_SECONDS;
  await ddb.send(new PutCommand({
    TableName: CACHE_TABLE_NAME,
    Item: {
      cache_key: cacheKey,
      payload,
      generated_at: payload.cache.generated_at,
      expires_at_epoch: expiresAt,
    },
  }));
  return {
    ...payload,
    cache: {
      ...payload.cache,
      status: 'refresh',
    },
  };
}

function aggregateProjectDashboards(dashboards, standard, projects) {
  const metrics = dashboards.reduce((sum, dashboard) => addDashboardMetrics(sum, dashboard.metrics), null);
  const generatedAtValues = dashboards
    .map((dashboard) => dashboard.cache?.generated_at)
    .filter(Boolean)
    .sort();
  return {
    project: {
      key: GLOBAL_PROJECT_KEY,
      display_name: 'Global',
      active: true,
      aggregate: true,
      aggregate_project_keys: projects.map((project) => project.key),
      data_status: 'aggregate',
    },
    metrics,
    standard: standardResponse(standard),
    cache: {
      generated_at: generatedAtValues[generatedAtValues.length - 1] || new Date().toISOString(),
      ttl_seconds: CACHE_TTL_SECONDS,
      status: dashboards.some((dashboard) => dashboard.cache?.status === 'refresh') ? 'refresh' : 'hit',
    },
    exclusions: {
      subscriber_synthetic_test: true,
      ulttra_people_synthetic_test: true,
    },
  };
}

function addDashboardMetrics(current, metrics = {}) {
  const base = current || {
    members: {
      active_total: 0,
      by_tier: Object.fromEntries(memberTiers.map((tier) => [tier, 0])),
    },
    founders: {
      active: 0,
      cap: 0,
    },
    leads: {
      last_30_days: 0,
    },
    revenue: {
      month_to_date_cents: 0,
      active_subscriptions: 0,
      currency: 'USD',
      revenue_scope: metrics.revenue?.revenue_scope || 'global',
    },
    website: {
      active_users_7d: 0,
      total_users_window: 0,
      window_label: `${GA_ANALYTICS_WINDOW_DAYS} days`,
      window_start: `${GA_ANALYTICS_WINDOW_DAYS}daysAgo`,
      window_end: 'today',
      geography: {
        countries: [],
        cities: [],
        metric: 'activeUsers',
        dimension_countries: 'country',
        dimension_cities: 'city',
      },
      month_comparison: null,
      traffic_sources: [],
      traffic_source_dimension: 'sessionDefaultChannelGroup',
      new_vs_returning: {
        dimension: 'newVsReturning',
        rows: [],
        total_active_users: 0,
      },
      property_id: null,
    },
    member_geography: {
      countries: [],
      cities: [],
    },
    priority_members: [],
  };

  const byTier = metrics.members?.by_tier || {};
  for (const tier of memberTiers) {
    base.members.by_tier[tier] += Number(byTier[tier] || 0);
  }
  base.members.active_total += Number(metrics.members?.active_total || 0);
  base.founders.active += Number(metrics.founders?.active || 0);
  base.founders.cap += Number(metrics.founders?.cap || 0);
  base.leads.last_30_days += Number(metrics.leads?.last_30_days || 0);
  base.revenue.month_to_date_cents += Number(metrics.revenue?.month_to_date_cents || 0);
  base.revenue.active_subscriptions += Number(metrics.revenue?.active_subscriptions || 0);
  base.revenue.currency = metrics.revenue?.currency || base.revenue.currency;
  base.revenue.revenue_scope = metrics.revenue?.revenue_scope || base.revenue.revenue_scope;
  base.revenue.month_to_date_display = formatUsd(base.revenue.month_to_date_cents);
  base.website.active_users_7d += Number(metrics.website?.active_users_7d || 0);
  base.website.total_users_window += Number(metrics.website?.total_users_window || 0);
  base.website.window_label = metrics.website?.window_label || base.website.window_label;
  base.website.window_start = metrics.website?.window_start || base.website.window_start;
  base.website.window_end = metrics.website?.window_end || base.website.window_end;
  base.website.geography = {
    countries: mergeRankedRows(base.website.geography.countries, metrics.website?.geography?.countries || []),
    cities: mergeRankedRows(base.website.geography.cities, metrics.website?.geography?.cities || []),
    metric: metrics.website?.geography?.metric || base.website.geography.metric,
    dimension_countries: metrics.website?.geography?.dimension_countries || base.website.geography.dimension_countries,
    dimension_cities: metrics.website?.geography?.dimension_cities || base.website.geography.dimension_cities,
  };
  base.website.traffic_sources = mergeRankedRows(base.website.traffic_sources, metrics.website?.traffic_sources || []);
  base.website.traffic_source_dimension = metrics.website?.traffic_source_dimension || base.website.traffic_source_dimension;
  base.website.new_vs_returning = mergeNewReturning(base.website.new_vs_returning, metrics.website?.new_vs_returning);
  base.website.month_comparison = mergeMonthComparison(base.website.month_comparison, metrics.website?.month_comparison);
  base.website.property_id = metrics.website?.property_id || base.website.property_id;
  base.member_geography = {
    countries: mergeRankedRows(base.member_geography.countries, metrics.member_geography?.countries || []),
    cities: mergeRankedRows(base.member_geography.cities, metrics.member_geography?.cities || []),
  };
  base.priority_members = mergePriorityMembers(base.priority_members, metrics.priority_members || []);
  return base;
}

function emptyProjectDashboard(project, standard, title) {
  return {
    project: {
      ...projectResponse(project),
      empty_state: {
        title,
        detail: 'Project registered. Data sources are not configured yet.',
      },
    },
    metrics: null,
    standard: standardResponse(standard),
    cache: {
      generated_at: new Date().toISOString(),
      ttl_seconds: CACHE_TTL_SECONDS,
      status: 'not_configured',
    },
    exclusions: {
      subscriber_synthetic_test: true,
      ulttra_people_synthetic_test: true,
    },
  };
}

function projectResponse(project = null) {
  const key = project?.key || PRESTTIGE_PROJECT_KEY;
  const displayName = project?.display_name || 'Presttige';
  return {
    key,
    display_name: displayName,
    active: project?.active === true,
    data_status: project?.data_status || (hasProjectData(project) ? 'live' : 'not_configured'),
    ga4_property_id: project?.ga4_property_id || null,
    stripe_account_or_tag: project?.stripe_account_or_tag || null,
  };
}

function hasProjectData(project) {
  if (!project?.active) return false;
  return project.key === PRESTTIGE_PROJECT_KEY
    && normalizeProjectKey(project.stripe_account_or_tag) === PRESTTIGE_PROJECT_KEY;
}

async function computeDashboard(user, standard, revenueScope) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [presttigeMetrics, ssmValues] = await Promise.all([
    readPresttigeMetrics(thirtyDaysAgo, now, revenueScope),
    readParameters([
      STRIPE_SECRET_PARAMETER,
      GA_CLIENT_SECRET_PARAMETER,
      GA_REFRESH_TOKEN_PARAMETER,
      FOUNDER_GLOBAL_CAP_PARAMETER,
    ]),
  ]);
  const [stripeMetrics, gaMetrics] = await Promise.all([
    readStripeMetrics(
      ssmValues[STRIPE_SECRET_PARAMETER],
      monthStart,
      revenueScope.kind === 'global'
        ? presttigeMetrics.realActiveSubscriptionIds
        : presttigeMetrics.attributedActiveSubscriptionIds,
      revenueScope.kind === 'global'
        ? presttigeMetrics.realActiveCustomerIds
        : presttigeMetrics.attributedActiveCustomerIds,
      revenueScope.response_label,
    ),
    readGaMetrics(ssmValues[GA_CLIENT_SECRET_PARAMETER], ssmValues[GA_REFRESH_TOKEN_PARAMETER]),
  ]);

  const founderCap = Number(ssmValues[FOUNDER_GLOBAL_CAP_PARAMETER] || 250);
  return {
    metrics: {
      members: {
        active_total: presttigeMetrics.activeTotal,
        by_tier: presttigeMetrics.byTier,
      },
      founders: {
        active: presttigeMetrics.byTier.founder || 0,
        cap: founderCap,
      },
      leads: {
        last_30_days: presttigeMetrics.leadsLast30Days,
      },
      revenue: stripeMetrics,
      website: gaMetrics,
      member_geography: presttigeMetrics.memberGeography,
      priority_members: presttigeMetrics.priorityMembers,
    },
    standard: standardResponse(standard),
    cache: {
      generated_at: now.toISOString(),
      ttl_seconds: CACHE_TTL_SECONDS,
      status: 'refresh',
    },
    exclusions: {
      subscriber_synthetic_test: true,
      ulttra_people_synthetic_test: true,
    },
  };
}

async function readPresttigeMetrics(thirtyDaysAgo, now, revenueScope = null) {
  const counterKeys = [
    { metric_group: 'counter', metric_key: 'members#active_total' },
    ...memberTiers.map((tier) => ({ metric_group: 'counter', metric_key: `members#tier#${tier}` })),
  ];
  const attributionGroup = revenueScope?.kind === 'person' && revenueScope.person_id
    ? `attributed_stripe_subscription#person#${revenueScope.person_id}`
    : null;
  const [counterResponse, leadsResponse, stripeLinksResponse, attributedStripeLinksResponse, memberCountryResponse, memberCityResponse, priorityMembersResponse] = await Promise.all([
    ddb.send(new BatchGetCommand({
      RequestItems: {
        [METRICS_TABLE_NAME]: {
          Keys: counterKeys,
          ProjectionExpression: 'metric_group, metric_key, #value',
          ExpressionAttributeNames: { '#value': 'value' },
        },
      },
    })),
    ddb.send(new QueryCommand({
      TableName: METRICS_TABLE_NAME,
      KeyConditionExpression: 'metric_group = :group AND metric_key BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':group': 'lead_day',
        ':start': toDayKey(thirtyDaysAgo),
        ':end': toDayKey(now),
      },
      ProjectionExpression: 'metric_key, #value',
      ExpressionAttributeNames: { '#value': 'value' },
    })),
    ddb.send(new QueryCommand({
      TableName: METRICS_TABLE_NAME,
      KeyConditionExpression: 'metric_group = :group',
      ExpressionAttributeValues: { ':group': 'active_stripe_subscription' },
      ProjectionExpression: 'metric_key, customer_id',
    })),
    attributionGroup ? ddb.send(new QueryCommand({
      TableName: METRICS_TABLE_NAME,
      KeyConditionExpression: 'metric_group = :group',
      ExpressionAttributeValues: { ':group': attributionGroup },
      ProjectionExpression: 'metric_key, customer_id',
    })) : Promise.resolve({ Items: [] }),
    ddb.send(new QueryCommand({
      TableName: METRICS_TABLE_NAME,
      KeyConditionExpression: 'metric_group = :group',
      ExpressionAttributeValues: { ':group': 'member_geo_country' },
      ProjectionExpression: 'metric_key, #value',
      ExpressionAttributeNames: { '#value': 'value' },
    })),
    ddb.send(new QueryCommand({
      TableName: METRICS_TABLE_NAME,
      KeyConditionExpression: 'metric_group = :group',
      ExpressionAttributeValues: { ':group': 'member_geo_city' },
      ProjectionExpression: 'metric_key, #value',
      ExpressionAttributeNames: { '#value': 'value' },
    })),
    ddb.send(new QueryCommand({
      TableName: METRICS_TABLE_NAME,
      KeyConditionExpression: 'metric_group = :group',
      ExpressionAttributeValues: { ':group': 'member_list_founder_patron' },
      ProjectionExpression: 'metric_key, tier, #name, country, city',
      ExpressionAttributeNames: { '#name': 'name' },
    })),
  ]);

  const counters = new Map((counterResponse.Responses?.[METRICS_TABLE_NAME] || [])
    .map((item) => [item.metric_key, Number(item.value || 0)]));
  const byTier = Object.fromEntries(memberTiers.map((tier) => [tier, counters.get(`members#tier#${tier}`) || 0]));
  const realActiveSubscriptionIds = new Set();
  const realActiveCustomerIds = new Set();
  const attributedActiveSubscriptionIds = new Set();
  const attributedActiveCustomerIds = new Set();
  for (const item of stripeLinksResponse.Items || []) {
    const subscriptionId = normalizeString(item.metric_key);
    const customerId = normalizeString(item.customer_id);
    if (subscriptionId) realActiveSubscriptionIds.add(subscriptionId);
    if (customerId) realActiveCustomerIds.add(customerId);
  }
  for (const item of attributedStripeLinksResponse.Items || []) {
    const subscriptionId = normalizeString(item.metric_key);
    const customerId = normalizeString(item.customer_id);
    if (subscriptionId) attributedActiveSubscriptionIds.add(subscriptionId);
    if (customerId) attributedActiveCustomerIds.add(customerId);
  }

  return {
    activeTotal: counters.get('members#active_total') || 0,
    byTier,
    leadsLast30Days: (leadsResponse.Items || []).reduce((sum, item) => sum + Number(item.value || 0), 0),
    realActiveSubscriptionIds,
    realActiveCustomerIds,
    attributedActiveSubscriptionIds,
    attributedActiveCustomerIds,
    memberGeography: {
      countries: rankedMetricRows(memberCountryResponse.Items || []),
      cities: rankedMetricRows(memberCityResponse.Items || []),
    },
    priorityMembers: priorityMemberRows(priorityMembersResponse.Items || []),
  };
}

async function readStripeMetrics(secretKey, monthStart, realSubscriptionIds, realCustomerIds, revenueScope = 'global') {
  if (!realSubscriptionIds.size && !realCustomerIds.size) {
    return {
      month_to_date_cents: 0,
      month_to_date_display: formatUsd(0),
      active_subscriptions: 0,
      currency: 'USD',
      revenue_scope: revenueScope,
    };
  }

  const monthStartEpoch = Math.floor(monthStart.getTime() / 1000);
  const [subscriptions, invoices] = await Promise.all([
    stripeList(secretKey, '/v1/subscriptions', { status: 'active', limit: 100 }),
    stripeList(secretKey, '/v1/invoices', {
      status: 'paid',
      limit: 100,
    }),
  ]);
  const activeSubscriptions = subscriptions.filter((subscription) => {
    const customer = normalizeStripeId(subscription.customer);
    return realSubscriptionIds.has(subscription.id) || realCustomerIds.has(customer);
  });
  const invoiceRevenue = invoices
    .filter((invoice) => {
      const customer = normalizeStripeId(invoice.customer);
      const subscription = normalizeStripeId(invoice.subscription);
      const paidAt = Number(invoice.status_transitions?.paid_at || 0);
      return paidAt >= monthStartEpoch
        && (realSubscriptionIds.has(subscription) || realCustomerIds.has(customer));
    })
    .reduce((sum, invoice) => sum + Number(invoice.amount_paid || 0), 0);

  return {
    month_to_date_cents: invoiceRevenue,
    month_to_date_display: formatUsd(invoiceRevenue),
    active_subscriptions: activeSubscriptions.length,
    currency: 'USD',
    revenue_scope: revenueScope,
  };
}

function getDashboardStandard(user) {
  const key = dashboardStandardKey(user);
  const standard = dashboardStandards[key];
  if (!standard) {
    throw httpError(403, 'Dashboard is available to Chairman, Admin, Team, and Consultant users.');
  }
  return standard;
}

function dashboardStandardKey(user) {
  if (isChairman(user)) return 'chairman';

  const roleName = normalizeType(user.role_name);
  if (roleName === 'administrator' || roleName === 'admin') return 'admin';
  if (roleName === 'team') return 'team';
  if (roleName === 'consultant') return 'consultant';

  const personType = normalizeType(user.person?.type);
  if (personType === 'admin' || personType === 'team') return personType;
  return '';
}

function isChairman(user) {
  const person = user?.person || null;
  return normalizeEmail(user?.email) === CHAIRMAN_EMAIL
    && normalizeEmail(person?.email) === CHAIRMAN_EMAIL
    && normalizeType(person?.type) === CHAIRMAN_TYPE
    && normalizeString(person?.status).toLowerCase() === 'active'
    && !isSynthetic(person?.synthetic_test);
}

function getRevenueScope(user, standard) {
  if (standard.revenue_scope === 'global') {
    return {
      kind: 'global',
      cache_key: 'revenue-global',
      response_label: 'global',
      person_id: null,
    };
  }

  const personId = user.person?.id ? String(user.person.id) : '';
  return {
    kind: 'person',
    cache_key: `revenue-person-${personId || user.id}`,
    response_label: 'own_attributed',
    person_id: personId,
  };
}

function standardResponse(standard) {
  return {
    type: standard.type,
    revenue_scope: standard.revenue_scope,
    panels: [...standard.panels],
    permissions: { ...standard.permissions },
    stubs_not_built: { ...dashboardStandardStubs },
  };
}

async function stripeList(secretKey, path, params) {
  const items = [];
  let startingAfter = null;
  do {
    const query = new URLSearchParams(params);
    if (startingAfter) query.set('starting_after', startingAfter);
    const response = await fetch(`https://api.stripe.com${path}?${query.toString()}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Stripe read failed: ${response.status}`);
    }
    const payload = await response.json();
    items.push(...(payload.data || []));
    startingAfter = payload.has_more && payload.data?.length ? payload.data[payload.data.length - 1].id : null;
  } while (startingAfter);
  return items;
}

async function readGaMetrics(clientSecret, refreshToken) {
  const accessToken = await getGaAccessToken(clientSecret, refreshToken);
  const monthWindow = gaMonthWindows(new Date());
  const analyticsWindow = {
    startDate: `${GA_ANALYTICS_WINDOW_DAYS}daysAgo`,
    endDate: 'today',
  };
  const [
    activeUsers7dReport,
    totalUsersWindowReport,
    countryReport,
    cityReport,
    currentMonthReport,
    lastMonthReport,
    trafficSourceReport,
    newReturningReport,
  ] = await Promise.all([
    gaRunReport(accessToken, {
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      metrics: [{ name: 'activeUsers' }],
    }),
    gaRunReport(accessToken, {
      dateRanges: [analyticsWindow],
      metrics: [{ name: 'totalUsers' }],
    }),
    gaRunReport(accessToken, {
      dateRanges: [analyticsWindow],
      dimensions: [{ name: 'country' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: GA_RANK_LIMIT,
    }),
    gaRunReport(accessToken, {
      dateRanges: [analyticsWindow],
      dimensions: [{ name: 'city' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: GA_RANK_LIMIT + 3,
    }),
    gaRunReport(accessToken, {
      dateRanges: [{ startDate: monthWindow.current.start_date, endDate: monthWindow.current.end_date }],
      metrics: [{ name: 'activeUsers' }],
    }),
    gaRunReport(accessToken, {
      dateRanges: [{ startDate: monthWindow.previous.start_date, endDate: monthWindow.previous.end_date }],
      metrics: [{ name: 'activeUsers' }],
    }),
    gaRunReport(accessToken, {
      dateRanges: [analyticsWindow],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: GA_RANK_LIMIT,
    }),
    gaRunReport(accessToken, {
      dateRanges: [analyticsWindow],
      dimensions: [{ name: 'newVsReturning' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: 5,
    }),
  ]);
  const activeUsers7d = firstMetricValue(activeUsers7dReport);
  const totalUsersWindow = firstMetricValue(totalUsersWindowReport);
  const currentMonthUsers = firstMetricValue(currentMonthReport);
  const lastMonthUsers = firstMetricValue(lastMonthReport);
  const newReturningRows = rankedGaRows(newReturningReport);
  const newReturningTotal = newReturningRows.reduce((sum, row) => sum + row.value, 0);
  return {
    active_users_7d: activeUsers7d,
    total_users_window: totalUsersWindow,
    window_label: `Last ${GA_ANALYTICS_WINDOW_DAYS} days`,
    window_start: analyticsWindow.startDate,
    window_end: analyticsWindow.endDate,
    geography: {
      countries: rankedGaRows(countryReport),
      cities: rankedGaRows(cityReport, 0, 0, GA_RANK_LIMIT + 3).filter((row) => !isUnsetDimension(row.label)).slice(0, GA_RANK_LIMIT),
      metric: 'activeUsers',
      dimension_countries: 'country',
      dimension_cities: 'city',
    },
    month_comparison: {
      metric: 'activeUsers',
      current: {
        ...monthWindow.current,
        users: currentMonthUsers,
      },
      previous: {
        ...monthWindow.previous,
        users: lastMonthUsers,
      },
      delta: currentMonthUsers - lastMonthUsers,
      direction: currentMonthUsers > lastMonthUsers ? 'up' : currentMonthUsers < lastMonthUsers ? 'down' : 'flat',
      delta_percent: lastMonthUsers > 0 ? Math.round(((currentMonthUsers - lastMonthUsers) / lastMonthUsers) * 1000) / 10 : null,
    },
    traffic_sources: rankedGaRows(trafficSourceReport),
    traffic_source_dimension: 'sessionDefaultChannelGroup',
    new_vs_returning: {
      dimension: 'newVsReturning',
      rows: newReturningRows.map((row) => ({
        ...row,
        percent: newReturningTotal > 0 ? Math.round((row.value / newReturningTotal) * 1000) / 10 : 0,
      })),
      total_active_users: newReturningTotal,
    },
    property_id: GA_PROPERTY_ID,
  };
}

async function getGaAccessToken(clientSecret, refreshToken) {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GA_CLIENT_ID,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!tokenResponse.ok) {
    throw new Error(`GA token refresh failed: ${tokenResponse.status}`);
  }
  const tokenPayload = await tokenResponse.json();
  return tokenPayload.access_token;
}

async function gaRunReport(accessToken, body) {
  const reportResponse = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${GA_PROPERTY_ID}:runReport`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!reportResponse.ok) {
    const detail = await reportResponse.text();
    throw new Error(`GA4 read failed: ${reportResponse.status} ${detail}`);
  }
  return reportResponse.json();
}

function firstMetricValue(report, metricIndex = 0) {
  return Number(report?.rows?.[0]?.metricValues?.[metricIndex]?.value || 0);
}

function rankedGaRows(report, dimensionIndex = 0, metricIndex = 0, limit = GA_RANK_LIMIT) {
  return (report?.rows || [])
    .map((row) => ({
      label: normalizeString(row.dimensionValues?.[dimensionIndex]?.value),
      value: Number(row.metricValues?.[metricIndex]?.value || 0),
    }))
    .filter((row) => row.label && row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function rankedMetricRows(items) {
  return items
    .map((item) => ({
      label: normalizeString(item.metric_key),
      value: Number(item.value || 0),
    }))
    .filter((row) => row.label && row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, GA_RANK_LIMIT);
}

function priorityMemberRows(items) {
  return sortPriorityMembers(items
    .map((item) => ({
      id: normalizeString(item.metric_key),
      tier: normalizeType(item.tier),
      name: normalizeString(item.name),
      country: normalizeString(item.country),
      city: normalizeString(item.city),
    }))
    .filter((item) => item.id && priorityMemberTiers.includes(item.tier)));
}

function mergeRankedRows(left = [], right = []) {
  const totals = new Map();
  for (const row of [...left, ...right]) {
    const label = normalizeString(row.label);
    if (!label) continue;
    totals.set(label, (totals.get(label) || 0) + Number(row.value || 0));
  }
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, GA_RANK_LIMIT);
}

function mergePriorityMembers(left = [], right = []) {
  const byId = new Map();
  for (const item of [...left, ...right]) {
    if (!item?.id) continue;
    byId.set(item.id, item);
  }
  return sortPriorityMembers([...byId.values()]);
}

function sortPriorityMembers(items) {
  const tierOrder = new Map(priorityMemberTiers.map((tier, index) => [tier, index]));
  return [...items].sort((left, right) => {
    const leftTier = tierOrder.get(normalizeType(left.tier)) ?? 99;
    const rightTier = tierOrder.get(normalizeType(right.tier)) ?? 99;
    if (leftTier !== rightTier) return leftTier - rightTier;
    return normalizeString(left.name).localeCompare(normalizeString(right.name), 'en');
  });
}

function mergeNewReturning(left = null, right = null) {
  const rows = mergeRankedRows(left?.rows || [], right?.rows || []);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return {
    dimension: 'newVsReturning',
    rows: rows.map((row) => ({
      ...row,
      percent: total > 0 ? Math.round((row.value / total) * 1000) / 10 : 0,
    })),
    total_active_users: total,
  };
}

function mergeMonthComparison(left = null, right = null) {
  if (!left && !right) return null;
  const currentUsers = Number(left?.current?.users || 0) + Number(right?.current?.users || 0);
  const previousUsers = Number(left?.previous?.users || 0) + Number(right?.previous?.users || 0);
  const sample = right || left;
  return {
    metric: 'activeUsers',
    current: {
      ...(sample?.current || {}),
      users: currentUsers,
    },
    previous: {
      ...(sample?.previous || {}),
      users: previousUsers,
    },
    delta: currentUsers - previousUsers,
    direction: currentUsers > previousUsers ? 'up' : currentUsers < previousUsers ? 'down' : 'flat',
    delta_percent: previousUsers > 0 ? Math.round(((currentUsers - previousUsers) / previousUsers) * 1000) / 10 : null,
  };
}

function gaMonthWindows(now) {
  const currentStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previousStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const previousEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return {
    current: {
      label: 'Current month',
      start_date: toDateOnly(currentStart),
      end_date: toDateOnly(now),
    },
    previous: {
      label: 'Last month',
      start_date: toDateOnly(previousStart),
      end_date: toDateOnly(previousEnd),
    },
  };
}

function toDateOnly(value) {
  return value.toISOString().slice(0, 10);
}

function isUnsetDimension(value) {
  return ['(not set)', 'not set', 'unknown', ''].includes(normalizeString(value).toLowerCase());
}

async function readParameters(names) {
  const response = await ssm.send(new GetParametersCommand({
    Names: names,
    WithDecryption: true,
  }));
  const values = {};
  for (const parameter of response.Parameters || []) {
    values[parameter.Name] = parameter.Value;
  }
  if (response.InvalidParameters?.length) {
    throw new Error(`Missing SSM parameters: ${response.InvalidParameters.join(', ')}`);
  }
  return values;
}

async function isInternalInviterEligible(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return false;
  const response = await ddb.send(new GetCommand({
    TableName: process.env.ELIGIBLE_INVITERS_TABLE_NAME || 'presttige-eligible-inviters',
    Key: { email: normalizedEmail },
  }));
  return Boolean(response.Item?.email);
}

async function invokeFounderAdmin({ actorId, actorEmail, inviterEmail, invitedEmail, invitedName }) {
  const event = {
    version: '2.0',
    routeKey: 'POST /admin/founder-invite',
    rawPath: '/admin/founder-invite',
    requestContext: {
      http: { method: 'POST', path: '/admin/founder-invite' },
      authorizer: {
        jwt: {
          claims: {
            sub: actorId,
            email: actorEmail,
            'cognito:groups': 'Admins',
          },
        },
      },
    },
    body: JSON.stringify({
      action: 'create_invite',
      inviter_email: inviterEmail,
      invited_email: invitedEmail,
      invited_name: invitedName,
    }),
  };
  const response = await lambda.send(new InvokeCommand({
    FunctionName: FOUNDER_ADMIN_FUNCTION_NAME,
    InvocationType: 'RequestResponse',
    Payload: Buffer.from(JSON.stringify(event)),
  }));
  const raw = JSON.parse(Buffer.from(response.Payload || []).toString('utf8') || '{}');
  const body = typeof raw.body === 'string' ? JSON.parse(raw.body || '{}') : raw.body || {};
  if (raw.statusCode >= 400 || body.error) {
    return { ok: false, statusCode: raw.statusCode, error: body.error };
  }
  return body;
}

async function founderInviteOutcome(result, invitedEmail) {
  const inviteeEmail = normalizeEmail(invitedEmail);
  if (!result.ok) {
    if (result.error === 'inviter_not_eligible') {
      return {
        ok: false,
        status: 'NOT_ELIGIBLE',
        invitee_email: inviteeEmail,
        message: 'Invitation could not be created.',
      };
    }
    return {
      ok: false,
      status: 'ERROR',
      invitee_email: inviteeEmail,
      message: 'Invitation could not be created.',
    };
  }

  const invitee = result.founder_email?.invitee || {};
  const inviter = result.founder_email?.inviter || {};
  const sendResults = [invitee, inviter];
  const sent = sendResults.some((item) => item?.sent === true);
  const alreadyInvited = sendResults.length > 0 && sendResults.every((item) => (
    item?.skipped === true && item?.reason === 'already_sent'
  ));

  if (sent) {
    return {
      ok: true,
      status: 'SENT',
      invitee_email: inviteeEmail,
      message: `Founder invitation sent successfully to ${inviteeEmail}.`,
    };
  }

  if (alreadyInvited) {
    const invitedAt = await readFounderInviteSentAt(inviteeEmail);
    return {
      ok: false,
      status: 'ALREADY_INVITED',
      invitee_email: inviteeEmail,
      invited_at: invitedAt,
      message: alreadyInvitedMessage(inviteeEmail, invitedAt),
    };
  }

  return {
    ok: false,
    status: 'ERROR',
    invitee_email: inviteeEmail,
    message: 'Invitation could not be created.',
  };
}

async function readFounderInviteSentAt(email) {
  if (!isValidEmail(email)) return null;
  try {
    const response = await ddb.send(new QueryCommand({
      TableName: process.env.TABLE_NAME || 'presttige-db',
      IndexName: process.env.EMAIL_INDEX_NAME || 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email,
      },
      Limit: 1,
    }));
    const lead = response.Items?.[0] || null;
    return normalizeString(lead?.founder_invite_email_sent_at || lead?.founder_inviter_email_sent_at) || null;
  } catch {
    return null;
  }
}

function alreadyInvitedMessage(email, invitedAt) {
  const suffix = invitedAt ? ` It was originally invited on ${invitedAt}.` : '';
  return `${email} was already invited and cannot be invited again yet.${suffix}`;
}

function buildPresttigeInvitationAuditItem({ user, invitedEmail, timestamp }) {
  const invitationId = `presttige_invitation_${randomUUID()}`;
  return {
    audit_id: randomUUID(),
    timestamp,
    lead_id: `standard_invitation#${invitedEmail}`,
    target_email: invitedEmail,
    action: 'chairman_presttige_invitation_send',
    actor_id: `directus:${user.id}`,
    actor_email: user.email,
    reviewer_id: `directus:${user.id}`,
    invitation_id: invitationId,
    previous_state: {},
    new_state: {
      invitation_type: 'presttige_standard_express_interest',
      invitee_email: invitedEmail,
      generated_by_email: user.email,
      generated_by_person_id: user.person?.id || null,
      cta_url: EXPRESS_INTEREST_URL,
      sender: COMMITTEE_EMAIL_FROM,
      tier: null,
    },
    metadata: {
      component: 'directus-extension-ulttra-dashboard-endpoint',
      source: 'chairman_dashboard',
      visible_inviter: false,
      journey: 'standard_express_interest',
    },
    is_test: isAntonioControlledTestEmail(invitedEmail),
    synthetic_test: isAntonioControlledTestEmail(invitedEmail),
  };
}

async function sendPresttigeInvitationEmail(invitedEmail) {
  const subject = 'An invitation to Presttige';
  const html = renderPresttigeInvitationHtml();
  const text = renderPresttigeInvitationText();
  return sendSesEmail({
    source: COMMITTEE_EMAIL_FROM,
    to: invitedEmail,
    subject,
    html,
    text,
  });
}

async function sendSesEmail({ source, to, subject, html, text }) {
  const credentials = await getAwsCredentials();
  const body = new URLSearchParams({
    Action: 'SendEmail',
    Version: '2010-12-01',
    Source: source,
    'ReplyToAddresses.member.1': source,
    'Destination.ToAddresses.member.1': to,
    'Message.Subject.Data': subject,
    'Message.Body.Html.Data': html,
    'Message.Body.Text.Data': text,
  }).toString();
  const endpoint = `https://email.${REGION}.amazonaws.com/`;
  const headers = signAwsRequest({
    method: 'POST',
    url: endpoint,
    region: REGION,
    service: 'ses',
    body,
    credentials,
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
    },
  });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body,
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`SES SendEmail failed: ${response.status} ${responseText}`);
  }
  return {
    MessageId: extractXmlValue(responseText, 'MessageId'),
  };
}

async function getAwsCredentials() {
  if (cachedAwsCredentials && cachedAwsCredentials.expiresAt > Date.now() + 300000) {
    return cachedAwsCredentials;
  }
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    cachedAwsCredentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN || '',
      expiresAt: Date.now() + 3600000,
    };
    return cachedAwsCredentials;
  }
  const credentialsUri = process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI
    || (process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
      ? `http://169.254.170.2${process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI}`
      : '');
  if (!credentialsUri) {
    throw new Error('AWS credentials are not available for SES send.');
  }
  const headers = {};
  if (process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN) {
    headers.Authorization = process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
  }
  const response = await fetch(credentialsUri, { headers });
  if (!response.ok) {
    throw new Error(`AWS credential metadata failed: ${response.status}`);
  }
  const data = await response.json();
  cachedAwsCredentials = {
    accessKeyId: data.AccessKeyId,
    secretAccessKey: data.SecretAccessKey,
    sessionToken: data.Token || '',
    expiresAt: data.Expiration ? new Date(data.Expiration).getTime() : Date.now() + 3600000,
  };
  return cachedAwsCredentials;
}

function signAwsRequest({ method, url, region, service, body, credentials, headers }) {
  const parsedUrl = new URL(url);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const requestHeaders = {
    ...headers,
    host: parsedUrl.host,
    'x-amz-date': amzDate,
  };
  if (credentials.sessionToken) {
    requestHeaders['x-amz-security-token'] = credentials.sessionToken;
  }
  const sortedHeaderNames = Object.keys(requestHeaders).map((name) => name.toLowerCase()).sort();
  const canonicalHeaders = sortedHeaderNames
    .map((name) => `${name}:${requestHeaders[name] || requestHeaders[Object.keys(requestHeaders).find((key) => key.toLowerCase() === name)]}\n`)
    .join('');
  const signedHeaders = sortedHeaderNames.join(';');
  const payloadHash = sha256Hex(body);
  const canonicalRequest = [
    method,
    parsedUrl.pathname || '/',
    parsedUrl.search ? parsedUrl.search.slice(1) : '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = getSignatureKey(credentials.secretAccessKey, dateStamp, region, service);
  const signature = hmacHex(signingKey, stringToSign);
  return {
    ...requestHeaders,
    Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function getSignatureKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmacBuffer(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacBuffer(kDate, region);
  const kService = hmacBuffer(kRegion, service);
  return hmacBuffer(kService, 'aws4_request');
}

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmacBuffer(key, value) {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function hmacHex(key, value) {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

function extractXmlValue(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}>([^<]+)</${tagName}>`));
  return match ? match[1] : null;
}

function renderPresttigeInvitationHtml() {
  const bodyHtml = [
    'The Committee is pleased to extend you an invitation to Presttige, following the recommendation of one of our members.',
    'Presttige is a private, curated network for business and lifestyle, a circle of accomplished individuals who value discretion, quality, and meaningful connection. Membership is by invitation only.',
    'You have been suggested as someone who belongs among them.',
    'To begin, simply express your interest below. From there, we will guide you through the next steps.',
  ].map((paragraph) => `<p style="margin:0 0 18px 0;">${escapeHtml(paragraph)}</p>`).join('');

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>An invitation to Presttige</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Source+Serif+Pro:wght@400;600&display=swap" rel="stylesheet">
  <!--[if mso]>
  <style type="text/css">
    body, table, td, a, p, span, h1, h2, h3 { font-family: Georgia, 'Times New Roman', serif !important; }
  </style>
  <![endif]-->
  <style type="text/css">
    body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; background-color: #F5F2ED; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    a { text-decoration: none; }
    [data-ogsc] body, [data-ogsb] body { background-color: #F5F2ED !important; }
    [data-ogsc] .paper, [data-ogsb] .paper { background-color: #FBF9F4 !important; }
    [data-ogsc] .ink, [data-ogsb] .ink { color: #0A0A0A !important; }
    [data-ogsc] .muted, [data-ogsb] .muted { color: #4A4A4A !important; }
    [data-ogsc] .gold, [data-ogsb] .gold { color: #8C7040 !important; }
    @media only screen and (max-width: 620px) {
      .container { width: 100% !important; }
      .px { padding-left: 28px !important; padding-right: 28px !important; }
      .title { font-size: 28px !important; line-height: 36px !important; }
      .body-pad { padding-top: 36px !important; padding-bottom: 32px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#F5F2ED;font-family:'Source Serif Pro',Georgia,serif;color:#0A0A0A;">
  <div style="display:none;font-size:1px;color:#F5F2ED;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    A private invitation to express your interest in Presttige.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F2ED;">
    <tr>
      <td align="center" style="padding: 0 16px;">
        <table role="presentation" class="container paper" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#FBF9F4;">
          <tr>
            <td align="center" style="background-color:#000000;padding: 36px 56px 28px 56px;margin:0;">
              <!--[if mso]>
              <p style="font-family:Georgia,serif;font-size:24px;color:#8C7040;letter-spacing:0.05em;margin:0 0 14px 0;">PRESTTIGE</p>
              <![endif]-->
              <!--[if !mso]><!-- -->
              <img src="https://presttige.net/assets/images/presttige-p-lettering.png?v=4" alt="Presttige" width="220" height="49" style="display:block;margin:0 auto 14px auto;border:0;outline:none;text-decoration:none;max-width:220px;">
              <!--<![endif]-->
              <p style="margin:0;font-family:'Source Serif Pro',Georgia,serif;font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#8C7040;">Private &middot; Selective &middot; Prestigious</p>
            </td>
          </tr>
          <tr>
            <td class="px body-pad" style="padding: 48px 56px 40px 56px;">
              <p class="gold" style="margin:0 0 24px 0;font-family:'Source Serif Pro',Georgia,serif;font-size:11px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#8C7040;">Invitation</p>
              <h1 class="title ink" style="margin:0 0 28px 0;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:500;font-size:34px;line-height:42px;color:#0A0A0A;">An invitation to Presttige</h1>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 32px 0;">
                <tr><td style="width:38px;border-top:1px solid #8C7040;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
              </table>
              <p class="ink" style="margin:0 0 20px 0;font-family:'Source Serif Pro',Georgia,serif;font-size:16px;line-height:26px;color:#0A0A0A;">Dear Guest,</p>
              <div class="muted" style="margin:0 0 36px 0;font-family:'Source Serif Pro',Georgia,serif;font-size:16px;line-height:26px;color:#4A4A4A;">
                ${bodyHtml}
              </div>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 36px 0;">
                <tr>
                  <td>
                    <!--[if mso]>
                    <v:rect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(EXPRESS_INTEREST_URL)}" style="height:46px;v-text-anchor:middle;width:220px;" stroke="t" strokecolor="#8C7040" strokeweight="1px" fillcolor="#FBF9F4">
                      <w:anchorlock/>
                      <center style="color:#8C7040;font-family:Georgia,serif;font-size:12px;font-weight:600;letter-spacing:2.4px;">Express Interest</center>
                    </v:rect>
                    <![endif]-->
                    <!--[if !mso]><!-- -->
                    <a href="${escapeHtml(EXPRESS_INTEREST_URL)}" class="gold" style="display:inline-block;padding:14px 36px;border:1px solid #8C7040;color:#8C7040;font-family:'Source Serif Pro',Georgia,serif;font-size:12px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;text-decoration:none;background-color:transparent;mso-padding-alt:0;">Express Interest</a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>
              <p class="muted" style="margin:0 0 18px 0;font-family:'Source Serif Pro',Georgia,serif;font-size:16px;line-height:26px;color:#4A4A4A;">Should you prefer, you are also welcome to visit presttige.net at your leisure.</p>
              <p class="muted" style="margin:0;font-family:'Source Serif Pro',Georgia,serif;font-size:16px;line-height:26px;color:#4A4A4A;">With our regards,</p>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 0 56px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-top:1px solid #D9D2C5;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 28px 56px 44px 56px;">
              <p class="ink" style="margin:0 0 4px 0;font-family:'Source Serif Pro',Georgia,serif;font-size:14px;font-weight:600;color:#0A0A0A;">The Committee</p>
              <p class="gold" style="margin:0;font-family:'Source Serif Pro',Georgia,serif;font-size:11px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#8C7040;">PRESTTIGE</p>
            </td>
          </tr>
          <tr>
            <td class="px" align="center" style="background-color:#000000;padding: 36px 56px 36px 56px;">
              <!--[if mso]>
              <p style="margin:0 0 16px 0;font-family:Georgia,serif;font-size:18px;font-weight:600;letter-spacing:0.12em;color:#8C7040;">PRESTTIGE</p>
              <![endif]-->
              <!--[if !mso]><!-- -->
              <img src="https://presttige.net/assets/images/presttige-p-ring.png" alt="Presttige" width="64" height="64" style="display:block;margin:0 auto 16px auto;border:0;outline:none;text-decoration:none;">
              <!--<![endif]-->
              <p style="margin:0 0 12px 0;font-family:'Source Serif Pro',Georgia,serif;font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#8C7040;">New York &middot; London &middot; Dubai</p>
              <p style="margin:0;font-family:'Source Serif Pro',Georgia,serif;font-size:12px;color:#D9D2C5;">
                <a href="https://presttige.net" style="color:#D9D2C5;text-decoration:none;">www.presttige.net</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderPresttigeInvitationText() {
  return [
    'PRESTTIGE',
    'Private · Selective · Prestigious',
    '',
    'Invitation',
    '',
    'An invitation to Presttige',
    '',
    'Dear Guest,',
    '',
    'The Committee is pleased to extend you an invitation to Presttige, following the recommendation of one of our members.',
    '',
    'Presttige is a private, curated network for business and lifestyle, a circle of accomplished individuals who value discretion, quality, and meaningful connection. Membership is by invitation only.',
    '',
    'You have been suggested as someone who belongs among them.',
    '',
    'To begin, simply express your interest below. From there, we will guide you through the next steps.',
    '',
    `Express Interest: ${EXPRESS_INTEREST_URL}`,
    '',
    'Should you prefer, you are also welcome to visit presttige.net at your leisure.',
    '',
    'With our regards,',
    'The Committee',
    'Presttige',
  ].join('\n');
}

function escapeHtml(value) {
  return normalizeString(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isAntonioControlledTestEmail(email) {
  return [
    'fq@freequenza.net',
    'antoniompereira@icloud.com',
    'antoniompereira@me.com',
    'alternativeservice@gmail.com',
  ].includes(normalizeEmail(email));
}

function normalizeString(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeEmail(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeTier(value) {
  return normalizeString(value).toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
}

function normalizeType(value) {
  return normalizeTier(value);
}

function normalizeProjectKey(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeStripeId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.id || '';
}

function isSynthetic(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  return ['true', '1', 'yes'].includes(normalizeString(value).toLowerCase());
}

function isValidEmail(email) {
  return Boolean(email && email.length <= 254 && email.includes('@') && email.split('@').pop().includes('.') && !/\s/.test(email));
}

function toDayKey(value) {
  return value.toISOString().slice(0, 10);
}

function formatUsd(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents || 0) / 100);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendError(res, error) {
  const status = error.status || 500;
  res.status(status).json({
    ok: false,
    error: status === 500 ? 'Dashboard request failed.' : error.message,
  });
}
