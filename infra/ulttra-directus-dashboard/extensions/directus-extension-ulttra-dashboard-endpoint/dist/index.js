import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetParameterCommand, GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';

const REGION = process.env.AWS_REGION || 'us-east-1';
const CACHE_TABLE_NAME = process.env.DASHBOARD_CACHE_TABLE_NAME || 'ulttra-crm-dashboard-cache';
const METRICS_TABLE_NAME = process.env.DASHBOARD_METRICS_TABLE_NAME || 'ulttra-crm-dashboard-metrics';
const CACHE_KEY = process.env.DASHBOARD_CACHE_KEY || 'presttige-dashboard-v1';
const CACHE_TTL_SECONDS = Number(process.env.DASHBOARD_CACHE_TTL_SECONDS || 300);
const STRIPE_SECRET_PARAMETER = process.env.STRIPE_SECRET_PARAMETER || '/presttige/stripe/secret-key';
const GA_CLIENT_SECRET_PARAMETER = process.env.GA4_OAUTH_CLIENT_SECRET_PARAMETER || '/ulttra/ga/oauth-client-secret';
const GA_REFRESH_TOKEN_PARAMETER = process.env.GA4_OAUTH_REFRESH_TOKEN_PARAMETER || '/ulttra/ga/oauth-refresh-token';
const GA_CLIENT_ID = process.env.GA4_OAUTH_CLIENT_ID || '430778007708-uerfhfgt42k4qfbgcobb9f0cpqi6om9e.apps.googleusercontent.com';
const GA_PROPERTY_ID = process.env.GA4_PROPERTY_ID || '530348665';
const FOUNDER_GLOBAL_CAP_PARAMETER = process.env.FOUNDER_GLOBAL_CAP_PARAMETER || '/presttige/founder-invite/global-cap';
const FOUNDER_ADMIN_FUNCTION_NAME = process.env.FOUNDER_ADMIN_FUNCTION_NAME || 'presttige-founder-admin';
const GLOBAL_PROJECT_KEY = 'global';
const PRESTTIGE_PROJECT_KEY = 'presttige';
const CHAIRMAN_EMAIL = 'apereira@presttige.net';
const CHAIRMAN_TYPE = 'chairman';

const memberTiers = ['club', 'premier', 'patron', 'founder'];
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
        if (!result.ok) {
          res.status(200).json({ ok: false, message: 'Invitation could not be created.' });
          return;
        }
        res.json({
          ok: true,
          message: 'Founder invitation created.',
          lead_id: result.lead_id,
          email: result.founder_email,
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
      property_id: null,
    },
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
  base.website.property_id = metrics.website?.property_id || base.website.property_id;
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
  const [counterResponse, leadsResponse, stripeLinksResponse, attributedStripeLinksResponse] = await Promise.all([
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
  const reportResponse = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${GA_PROPERTY_ID}:runReport`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenPayload.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      metrics: [{ name: 'activeUsers' }],
    }),
  });
  if (!reportResponse.ok) {
    throw new Error(`GA4 read failed: ${reportResponse.status}`);
  }
  const report = await reportResponse.json();
  return {
    active_users_7d: Number(report.rows?.[0]?.metricValues?.[0]?.value || 0),
    property_id: GA_PROPERTY_ID,
  };
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
