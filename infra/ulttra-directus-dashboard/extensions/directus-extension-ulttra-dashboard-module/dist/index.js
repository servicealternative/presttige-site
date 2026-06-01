import { defineComponent, h, onMounted, ref, resolveComponent } from 'vue';
import { useApi } from '@directus/extensions-sdk';

const cardStyle = {
  border: '1px solid var(--theme--border-color)',
  borderRadius: '8px',
  padding: '20px',
  background: 'var(--theme--background)',
  minHeight: '118px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
};

const Dashboard = defineComponent({
  setup() {
    const api = useApi();
    const loading = ref(true);
    const error = ref('');
    const payload = ref(null);
    const userProfile = ref(null);
    const inviteName = ref('');
    const inviteBusy = ref(false);
    const inviteMessage = ref('');
    const inviteSuccess = ref(false);
    const tierDetailOpen = ref(false);
    const selectedProject = ref('global');

    async function loadDashboard(force = false, projectKey = selectedProject.value) {
      loading.value = true;
      error.value = '';
      try {
        const params = { project: projectKey };
        if (force) params.refresh = 'true';
        const response = await api.get('/ulttra-dashboard', {
          params,
        });
        payload.value = response.data;
        selectedProject.value = response.data?.selected_project || projectKey;
      } catch (err) {
        error.value = err?.response?.data?.error || 'Dashboard could not be loaded.';
      } finally {
        loading.value = false;
      }
    }

    async function loadUserProfile() {
      try {
        const response = await api.get('/users/me', {
          params: { fields: 'first_name,last_name,email' },
        });
        userProfile.value = response.data?.data || null;
      } catch {
        userProfile.value = null;
      }
    }

    async function submitInvite() {
      inviteBusy.value = true;
      inviteMessage.value = '';
      inviteSuccess.value = false;
      try {
        const response = await api.post('/ulttra-dashboard/founder-invite', {
          invited_name: inviteName.value,
        });
        inviteSuccess.value = response.data?.ok === true;
        inviteMessage.value = response.data?.message || 'Invitation request processed.';
        if (inviteSuccess.value) {
          inviteName.value = '';
        }
      } catch (err) {
        inviteSuccess.value = false;
        inviteMessage.value = err?.response?.data?.message || 'Invitation request could not be processed.';
      } finally {
        inviteBusy.value = false;
      }
    }

    function selectProject(projectKey) {
      if (!projectKey || projectKey === selectedProject.value) return;
      selectedProject.value = projectKey;
      tierDetailOpen.value = false;
      loadDashboard(false, projectKey);
    }

    onMounted(() => {
      loadUserProfile();
      loadDashboard(false);
    });

    return {
      loading,
      error,
      payload,
      userProfile,
      inviteName,
      inviteBusy,
      inviteMessage,
      inviteSuccess,
      tierDetailOpen,
      selectedProject,
      loadDashboard,
      selectProject,
      submitInvite,
    };
  },
  render() {
    const PrivateView = resolveComponent('private-view');
    const data = this.payload || {};
    const metrics = data.metrics || {};
    const members = metrics.members || {};
    const tiers = members.by_tier || {};
    const founders = metrics.founders || {};
    const leads = metrics.leads || {};
    const revenue = metrics.revenue || {};
    const ga = metrics.website || {};
    const cache = data.cache || {};
    const title = formatDashboardTitle(this.userProfile, data.current_user);
    const tabs = data.project_tabs || defaultProjectTabs();
    const selectedProject = data.selected_project || this.selectedProject || 'global';
    const project = data.project || {};
    const emptyState = project.empty_state || null;
    const projectContent = emptyState ? [
      projectEmptyState(emptyState),
    ] : [
      h('section', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '16px',
          marginBottom: '28px',
        },
      }, [
        activeMembersCard(members.active_total ?? '-', tiers, this.tierDetailOpen, () => { this.tierDetailOpen = !this.tierDetailOpen; }),
        metricCard('Founders', `${founders.active ?? 0} / ${founders.cap ?? 250}`, 'Global cap'),
        metricCard('New applications', leads.last_30_days ?? 0, 'Last 30 days'),
        metricCard('Revenue this month', revenue.month_to_date_display || '$0.00', `${revenue.active_subscriptions ?? 0} active subscriptions`),
        metricCard('Website visitors', ga.active_users_7d ?? 0, 'Active users, last 7 days'),
      ]),
      data.current_user?.eligible_inviter ? h('section', {
        style: {
          border: '1px solid var(--theme--border-color)',
          borderRadius: '8px',
          padding: '24px',
          background: 'var(--theme--background)',
          marginBottom: '20px',
        },
      }, [
        h('div', {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            gap: '16px',
            alignItems: 'center',
            marginBottom: '18px',
          },
        }, [
          h('div', [
            h('h2', { style: { margin: '0 0 6px', fontSize: '22px' } }, 'Founder Invitation'),
            h('p', { style: { margin: 0, color: 'var(--theme--foreground-subdued)' } }, 'Invitee details only. The inviter is your logged-in Ulttra identity.'),
          ]),
          h('span', {
            style: {
              fontSize: '13px',
              color: 'var(--success)',
            },
          }, 'You are eligible to submit an invitation.'),
        ]),
        h('form', {
          style: {
            display: 'grid',
            gridTemplateColumns: 'minmax(180px, 1fr) auto',
            gap: '12px',
            alignItems: 'end',
          },
          onSubmit: (event) => {
            event.preventDefault();
            this.submitInvite();
          },
        }, [
          fieldInput('Invitee name', this.inviteName, (value) => { this.inviteName = value; }, 'text'),
          h('button', { class: 'button', disabled: this.inviteBusy || !this.inviteName }, this.inviteBusy ? 'Creating' : 'Create invite'),
        ]),
        this.inviteMessage ? h('p', {
          style: {
            margin: '14px 0 0',
            color: this.inviteSuccess ? 'var(--success)' : 'var(--theme--foreground-subdued)',
          },
        }, this.inviteMessage) : null,
      ]) : null,
      h('p', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px', margin: 0 } }, [
        `Last updated ${cache.generated_at || 'not yet'}. Cache ${cache.status || 'unknown'}. `,
        `Data sources: DynamoDB, Stripe, GA4.`,
      ]),
    ];

    return h(PrivateView, { title }, {
      default: () => h('div', { style: { padding: '32px', maxWidth: '1280px' } }, [
        projectTabList(tabs, selectedProject, (projectKey) => this.selectProject(projectKey)),
        h('div', {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px',
            marginBottom: '28px',
          },
        }, [
          h('p', { style: { margin: 0, color: 'var(--theme--foreground-subdued)' } }, 'Real data only. Test records are excluded from every count.'),
          h('button', {
            class: 'button',
            disabled: this.loading,
            onClick: () => this.loadDashboard(true),
          }, this.loading ? 'Loading' : 'Refresh'),
        ]),
        this.error ? h('div', {
          style: {
            padding: '14px 16px',
            border: '1px solid var(--danger)',
            borderRadius: '8px',
            color: 'var(--danger)',
            marginBottom: '20px',
          },
        }, this.error) : null,
        ...projectContent,
      ]),
    });
  },
});

function formatDashboardTitle(profile, currentUser) {
  const name = [profile?.first_name, profile?.last_name]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  return `ULTTRA · ${name || currentUser?.email || 'User'}`;
}

function defaultProjectTabs() {
  return [
    { key: 'global', display_name: 'Global' },
    { key: 'presttige', display_name: 'Presttige' },
    { key: 'pets_lab', display_name: 'Pets Lab' },
  ];
}

function projectTabList(tabs, selectedProject, selectProject) {
  return h('nav', {
    'aria-label': 'Projects',
    style: {
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap',
      marginBottom: '20px',
    },
  }, tabs.map((tab) => {
    const selected = tab.key === selectedProject;
    return h('button', {
      type: 'button',
      'aria-pressed': String(selected),
      style: {
        appearance: 'none',
        border: 0,
        background: 'transparent',
        padding: 0,
        margin: 0,
        font: 'inherit',
        cursor: 'pointer',
        color: selected ? 'var(--theme--foreground-accent)' : 'var(--theme--foreground-subdued)',
        fontWeight: selected ? 700 : 400,
        lineHeight: '24px',
      },
      onMouseenter: (event) => {
        if (!selected) event.currentTarget.style.color = 'var(--theme--foreground)';
      },
      onMouseleave: (event) => {
        event.currentTarget.style.color = selected ? 'var(--theme--foreground-accent)' : 'var(--theme--foreground-subdued)';
      },
      onClick: () => selectProject(tab.key),
    }, tab.display_name);
  }));
}

function projectEmptyState(emptyState) {
  return h('section', {
    style: {
      border: '1px solid var(--theme--border-color)',
      borderRadius: '8px',
      padding: '28px',
      background: 'var(--theme--background)',
      marginBottom: '20px',
      maxWidth: '620px',
    },
  }, [
    h('h2', { style: { margin: '0 0 8px', fontSize: '22px' } }, emptyState.title || 'No data yet'),
    h('p', { style: { margin: 0, color: 'var(--theme--foreground-subdued)' } }, emptyState.detail || 'Project registered. Data sources are not configured yet.'),
  ]);
}

function activeMembersCard(value, tiers, open, toggle) {
  return h('article', {
    role: 'button',
    tabindex: '0',
    'aria-expanded': String(open),
    style: {
      ...cardStyle,
      cursor: 'pointer',
    },
    onClick: toggle,
    onKeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    },
  }, [
    h('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        gap: '12px',
        alignItems: 'center',
      },
    }, [
      h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, 'Active members'),
      h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, open ? 'Hide tiers' : 'Show tiers'),
    ]),
    h('strong', { style: { fontSize: '30px', lineHeight: '36px' } }, String(value)),
    h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, 'Club, Premier, Patron, Founder'),
    open ? h('div', {
      style: {
        display: 'grid',
        gap: '8px',
        paddingTop: '12px',
        marginTop: '4px',
        borderTop: '1px solid var(--theme--border-color)',
      },
    }, [
      tierRow('Club', tiers.club ?? 0),
      tierRow('Premier', tiers.premier ?? 0),
      tierRow('Patron', tiers.patron ?? 0),
    ]) : null,
  ]);
}

function tierRow(label, value) {
  return h('div', {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '12px',
      fontSize: '13px',
    },
  }, [
    h('span', { style: { color: 'var(--theme--foreground-subdued)' } }, label),
    h('strong', null, String(value)),
  ]);
}

function metricCard(label, value, detail) {
  return h('article', { style: cardStyle }, [
    h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, label),
    h('strong', { style: { fontSize: '30px', lineHeight: '36px' } }, String(value)),
    h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, detail),
  ]);
}

function fieldInput(label, value, update, type) {
  return h('label', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, [
    h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, label),
    h('input', {
      type,
      value,
      required: type === 'email',
      style: {
        height: '44px',
        borderRadius: '6px',
        border: '1px solid var(--theme--border-color)',
        padding: '0 12px',
        background: 'var(--theme--form--field--input--background)',
        color: 'var(--theme--foreground)',
      },
      onInput: (event) => update(event.target.value),
    }),
  ]);
}

export default {
  id: 'ulttra-dashboard',
  name: 'Dashboard',
  icon: 'dashboard',
  routes: [
    {
      path: '',
      component: Dashboard,
    },
  ],
};
