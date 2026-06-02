import { defineComponent, h, onMounted, onUnmounted, ref, resolveComponent } from 'vue';
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
    const inviteEmail = ref('');
    const inviteBusy = ref(false);
    const inviteMessage = ref('');
    const inviteSuccess = ref(false);
    const inviteStatus = ref('');
    const inviteCooldownRemaining = ref(0);
    const inviteCooldownTimer = ref(null);
    const presttigeInviteEmail = ref('');
    const presttigeInviteBusy = ref(false);
    const presttigeInviteMessage = ref('');
    const presttigeInviteSuccess = ref(false);
    const tierDetailOpen = ref(false);
    const selectedPriorityMemberId = ref('');
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
      inviteStatus.value = '';
      try {
        const response = await api.post('/ulttra-dashboard/founder-invite', {
          invited_name: inviteName.value,
          invited_email: inviteEmail.value,
        });
        inviteStatus.value = response.data?.status || 'ERROR';
        inviteSuccess.value = response.data?.status === 'SENT';
        inviteMessage.value = response.data?.message || 'Invitation request processed.';
        if (response.data?.status === 'SENT') {
          inviteName.value = '';
          inviteEmail.value = '';
          startInviteCooldown();
        }
      } catch (err) {
        inviteSuccess.value = false;
        inviteStatus.value = 'ERROR';
        inviteMessage.value = err?.response?.data?.message || 'Invitation request could not be processed.';
      } finally {
        inviteBusy.value = false;
      }
    }

    function startInviteCooldown() {
      clearInviteCooldown();
      inviteCooldownRemaining.value = 120;
      inviteCooldownTimer.value = window.setInterval(() => {
        inviteCooldownRemaining.value = Math.max(0, inviteCooldownRemaining.value - 1);
        if (inviteCooldownRemaining.value === 0) {
          clearInviteCooldown();
          inviteMessage.value = '';
          inviteSuccess.value = false;
          inviteStatus.value = '';
          inviteName.value = '';
          inviteEmail.value = '';
        }
      }, 1000);
    }

    function clearInviteCooldown() {
      if (inviteCooldownTimer.value) {
        window.clearInterval(inviteCooldownTimer.value);
        inviteCooldownTimer.value = null;
      }
    }

    async function submitPresttigeInvitation() {
      presttigeInviteBusy.value = true;
      presttigeInviteMessage.value = '';
      presttigeInviteSuccess.value = false;
      try {
        const response = await api.post('/ulttra-dashboard/presttige-invite', {
          invited_email: presttigeInviteEmail.value,
        });
        presttigeInviteSuccess.value = response.data?.status === 'SENT';
        presttigeInviteMessage.value = response.data?.message || 'Presttige invitation request processed.';
        if (response.data?.status === 'SENT') {
          presttigeInviteEmail.value = '';
        }
      } catch (err) {
        presttigeInviteSuccess.value = false;
        presttigeInviteMessage.value = err?.response?.data?.message || 'Presttige invitation could not be sent.';
      } finally {
        presttigeInviteBusy.value = false;
      }
    }

    function selectProject(projectKey) {
      if (!projectKey || projectKey === selectedProject.value) return;
      selectedProject.value = projectKey;
      tierDetailOpen.value = false;
      selectedPriorityMemberId.value = '';
      loadDashboard(false, projectKey);
    }

    onMounted(() => {
      loadUserProfile();
      loadDashboard(false);
    });
    onUnmounted(() => {
      clearInviteCooldown();
    });

    return {
      loading,
      error,
      payload,
      userProfile,
      inviteName,
      inviteEmail,
      inviteBusy,
      inviteMessage,
      inviteSuccess,
      inviteStatus,
      inviteCooldownRemaining,
      presttigeInviteEmail,
      presttigeInviteBusy,
      presttigeInviteMessage,
      presttigeInviteSuccess,
      tierDetailOpen,
      selectedPriorityMemberId,
      selectedProject,
      loadDashboard,
      selectProject,
      submitInvite,
      submitPresttigeInvitation,
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
    const inviteCooldownActive = this.inviteCooldownRemaining > 0;
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
      analyticsSection(metrics),
      founderPatronMembersSection(metrics.priority_members || [], this.selectedPriorityMemberId, (memberId) => {
        this.selectedPriorityMemberId = this.selectedPriorityMemberId === memberId ? '' : memberId;
      }),
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
        inviteCooldownActive ? null : h('form', {
          style: {
            display: 'grid',
            gap: '12px',
          },
          onSubmit: (event) => {
            event.preventDefault();
            this.submitInvite();
          },
        }, [
          h('div', {
            style: {
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '12px',
              alignItems: 'end',
            },
          }, [
            fieldInput('Invitee name', this.inviteName, (value) => { this.inviteName = value; }, 'text', {
              name: 'invited_name',
              autocomplete: 'name',
              required: true,
            }),
            fieldInput('Invitee email', this.inviteEmail, (value) => { this.inviteEmail = value; }, 'email', {
              name: 'invited_email',
              autocomplete: 'email',
              required: true,
            }),
          ]),
          h('div', {
            style: {
              display: 'flex',
              justifyContent: 'flex-end',
            },
          }, [
            h('button', { class: 'button', disabled: this.inviteBusy || !this.inviteName || !this.inviteEmail }, this.inviteBusy ? 'Creating' : 'Create invite'),
          ]),
        ]),
        this.inviteMessage ? h('p', {
          style: {
            margin: '14px 0 0',
            color: this.inviteSuccess ? 'var(--success)' : 'var(--theme--foreground-subdued)',
          },
        }, this.inviteMessage) : null,
        inviteCooldownActive ? h('p', {
          style: {
            margin: '8px 0 0',
            color: 'var(--theme--foreground-subdued)',
          },
        }, `You can create another invitation in ${this.inviteCooldownRemaining} seconds.`) : null,
      ]) : null,
      data.current_user?.is_chairman ? chairmanPresttigeInvitationSection({
        email: this.presttigeInviteEmail,
        busy: this.presttigeInviteBusy,
        message: this.presttigeInviteMessage,
        success: this.presttigeInviteSuccess,
        updateEmail: (value) => { this.presttigeInviteEmail = value; },
        submit: () => this.submitPresttigeInvitation(),
      }) : null,
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

function chairmanPresttigeInvitationSection({ email, busy, message, success, updateEmail, submit }) {
  return h('section', {
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
        h('h2', { style: { margin: '0 0 6px', fontSize: '22px' } }, 'Presttige Invitation'),
        h('p', { style: { margin: 0, color: 'var(--theme--foreground-subdued)' } }, 'Committee invitation into the standard Express Interest flow.'),
      ]),
    ]),
    h('form', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'minmax(260px, 1fr) auto',
        gap: '12px',
        alignItems: 'end',
      },
      onSubmit: (event) => {
        event.preventDefault();
        submit();
      },
    }, [
      fieldInput('Invitee email', email, updateEmail, 'email', {
        name: 'presttige_invited_email',
        autocomplete: 'email',
        required: true,
      }),
      h('button', {
        class: 'button',
        disabled: busy || !email,
        style: {
          minHeight: '44px',
          whiteSpace: 'nowrap',
        },
      }, busy ? 'Sending' : 'Send Presttige invitation'),
    ]),
    message ? h('p', {
      style: {
        margin: '14px 0 0',
        color: success ? 'var(--success)' : 'var(--theme--foreground-subdued)',
      },
    }, message) : null,
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

function analyticsSection(metrics) {
  const website = metrics.website || {};
  const geography = website.geography || {};
  const memberGeography = metrics.member_geography || {};
  const newReturningRows = (website.new_vs_returning?.rows || []).map((row) => ({
    label: titleCase(row.label),
    value: row.value,
    display_value: `${row.value} (${formatPercent(row.percent)})`,
  }));
  return h('section', {
    style: {
      marginBottom: '28px',
    },
  }, [
    h('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        gap: '16px',
        alignItems: 'flex-end',
        marginBottom: '14px',
      },
    }, [
      h('div', [
        h('h2', { style: { margin: '0 0 6px', fontSize: '22px' } }, 'Analytics'),
        h('p', { style: { margin: 0, color: 'var(--theme--foreground-subdued)' } }, `${website.window_label || 'Last 30 days'}, GA4 and member geography.`),
      ]),
    ]),
    h('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '16px',
      },
    }, [
      analyticsCard('Total website users', [
        h('strong', { style: { fontSize: '30px', lineHeight: '36px' } }, String(website.total_users_window ?? 0)),
        h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, `${website.window_label || 'Last 30 days'}, totalUsers`),
        h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, `Active users, last 7 days: ${website.active_users_7d ?? 0}`),
      ]),
      monthComparisonCard(website.month_comparison),
      analyticsCard('Website geography', [
        smallHeading('Countries'),
        rankedList(geography.countries || [], 'No country data yet'),
        smallHeading('Cities'),
        rankedList(geography.cities || [], 'No city data yet'),
      ]),
      analyticsCard('Traffic sources', [
        rankedList(website.traffic_sources || [], 'No source data yet'),
        h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '12px' } }, 'Dimension: sessionDefaultChannelGroup'),
      ]),
      analyticsCard('New vs returning', [
        rankedList(newReturningRows, 'No visitor type data yet'),
        h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '12px' } }, 'Dimension: newVsReturning'),
      ]),
      analyticsCard('Member geography', [
        smallHeading('Countries'),
        rankedList(memberGeography.countries || [], 'No member country data yet'),
        smallHeading('Cities'),
        rankedList(memberGeography.cities || [], 'No member city data yet'),
      ]),
    ]),
  ]);
}

function analyticsCard(title, children) {
  return h('article', {
    style: {
      ...cardStyle,
      minHeight: 'auto',
    },
  }, [
    h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, title),
    ...children,
  ]);
}

function founderPatronMembersSection(members, selectedMemberId, selectMember) {
  return h('section', {
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
        alignItems: 'flex-end',
        marginBottom: '18px',
      },
    }, [
      h('div', [
        h('h2', { style: { margin: '0 0 6px', fontSize: '22px' } }, 'Founders and Patrons'),
        h('p', { style: { margin: 0, color: 'var(--theme--foreground-subdued)' } }, 'Active paying Founder and Patron members only.'),
      ]),
      h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, `${members.length} listed`),
    ]),
    members.length ? h('div', {
      style: {
        display: 'grid',
        gap: '8px',
      },
    }, [
      h('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'minmax(120px, 1fr) minmax(120px, 1fr) minmax(160px, 1.4fr) auto',
          gap: '12px',
          color: 'var(--theme--foreground-subdued)',
          fontSize: '12px',
          fontWeight: 700,
          padding: '0 12px',
        },
      }, [
        h('span', null, 'Country'),
        h('span', null, 'City'),
        h('span', null, 'Name'),
        h('span', null, 'Tier'),
      ]),
      ...members.map((member) => h('div', { key: member.id }, [
        h('button', {
          type: 'button',
          style: {
            width: '100%',
            display: 'grid',
            gridTemplateColumns: 'minmax(120px, 1fr) minmax(120px, 1fr) minmax(160px, 1.4fr) auto',
            gap: '12px',
            alignItems: 'center',
            textAlign: 'left',
            border: '1px solid var(--theme--border-color)',
            borderRadius: '8px',
            padding: '12px',
            background: selectedMemberId === member.id ? 'var(--theme--background-subdued, var(--theme--background))' : 'var(--theme--background)',
            color: 'var(--theme--foreground)',
            cursor: 'pointer',
          },
          onClick: () => selectMember(member.id),
        }, [
          h('span', null, member.country || 'Not set'),
          h('span', null, member.city || 'Not set'),
          h('strong', null, member.name || 'Unnamed member'),
          tierChip(member.tier),
        ]),
        selectedMemberId === member.id ? priorityMemberDetail(member) : null,
      ])),
    ]) : h('div', {
      style: {
        border: '1px solid var(--theme--border-color)',
        borderRadius: '8px',
        padding: '18px',
        color: 'var(--theme--foreground-subdued)',
      },
    }, 'No Founders or Patrons yet'),
  ]);
}

function tierChip(tier) {
  const label = titleCase(tier);
  return h('span', {
    style: {
      display: 'inline-flex',
      justifyContent: 'center',
      border: '1px solid var(--theme--border-color)',
      borderRadius: '999px',
      padding: '4px 9px',
      color: 'var(--theme--foreground)',
      fontSize: '12px',
      whiteSpace: 'nowrap',
    },
  }, label);
}

function priorityMemberDetail(member) {
  return h('div', {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      gap: '12px',
      border: '1px solid var(--theme--border-color)',
      borderTop: 0,
      borderRadius: '0 0 8px 8px',
      padding: '14px 12px',
      color: 'var(--theme--foreground-subdued)',
      fontSize: '13px',
    },
  }, [
    detailItem('Country', member.country || 'Not set'),
    detailItem('City', member.city || 'Not set'),
    detailItem('Name', member.name || 'Unnamed member'),
    detailItem('Tier', titleCase(member.tier)),
  ]);
}

function detailItem(label, value) {
  return h('div', { style: { display: 'grid', gap: '4px' } }, [
    h('span', { style: { fontSize: '12px' } }, label),
    h('strong', { style: { color: 'var(--theme--foreground)' } }, value),
  ]);
}

function monthComparisonCard(comparison) {
  if (!comparison) {
    return analyticsCard('Current vs last month', [
      h('strong', { style: { fontSize: '30px', lineHeight: '36px' } }, '0'),
      h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, 'No month comparison yet'),
    ]);
  }
  const current = comparison.current || {};
  const previous = comparison.previous || {};
  const delta = Number(comparison.delta || 0);
  const direction = comparison.direction || 'flat';
  const deltaText = `${delta > 0 ? '+' : ''}${delta}`;
  const percentText = comparison.delta_percent === null || comparison.delta_percent === undefined
    ? ''
    : `, ${comparison.delta_percent > 0 ? '+' : ''}${comparison.delta_percent}%`;
  return analyticsCard('Current vs last month', [
    h('strong', { style: { fontSize: '30px', lineHeight: '36px' } }, String(current.users ?? 0)),
    h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, `Current month, activeUsers. Last month: ${previous.users ?? 0}.`),
    h('span', {
      style: {
        color: direction === 'up' ? 'var(--success)' : direction === 'down' ? 'var(--danger)' : 'var(--theme--foreground-subdued)',
        fontSize: '13px',
      },
    }, `${directionLabel(direction)} ${deltaText}${percentText}`),
  ]);
}

function smallHeading(label) {
  return h('span', {
    style: {
      color: 'var(--theme--foreground)',
      fontSize: '12px',
      fontWeight: 700,
      marginTop: '4px',
    },
  }, label);
}

function rankedList(rows, emptyText) {
  if (!rows.length) {
    return h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, emptyText);
  }
  return h('ol', {
    style: {
      display: 'grid',
      gap: '6px',
      margin: 0,
      paddingLeft: '18px',
      color: 'var(--theme--foreground-subdued)',
      fontSize: '13px',
    },
  }, rows.map((row) => h('li', {
    style: {
      paddingLeft: '2px',
    },
  }, [
    h('span', null, row.label),
    h('strong', { style: { color: 'var(--theme--foreground)', float: 'right', marginLeft: '12px' } }, String(row.display_value ?? row.value)),
  ])));
}

function titleCase(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function formatPercent(value) {
  const numeric = Number(value || 0);
  return `${numeric.toFixed(numeric % 1 === 0 ? 0 : 1)}%`;
}

function directionLabel(direction) {
  if (direction === 'up') return 'Up';
  if (direction === 'down') return 'Down';
  return 'Flat';
}

function fieldInput(label, value, update, type, options = {}) {
  return h('label', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, [
    h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, label),
    h('input', {
      type,
      name: options.name,
      value,
      required: options.required === true,
      autocomplete: options.autocomplete,
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
