import { defineComponent, h, onMounted, onUnmounted, ref, resolveComponent } from 'vue';
import { useApi } from '@directus/extensions-sdk';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailInTextPattern = /[^\s@]+@[^\s@]+\.[^\s@]+/;

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
    const inviteNameError = ref('');
    const inviteEmailError = ref('');
    const inviteCooldownRemaining = ref(0);
    const inviteCooldownTimer = ref(null);
    const presttigeInviteEmail = ref('');
    const presttigeInviteBusy = ref(false);
    const presttigeInviteMessage = ref('');
    const presttigeInviteSuccess = ref(false);
    const registeredInviteBusyLeadId = ref('');
    const registeredExcludeBusyLeadId = ref('');
    const registeredInviteMessage = ref('');
    const registeredInviteSuccess = ref(false);
    const tierDetailOpen = ref(false);
    const selectedPriorityMemberId = ref('');
    const selectedProject = ref('global');
    const financeMonth = ref('');
    const financeBusy = ref(false);
    const financeMessage = ref('');
    const newCostName = ref('');
    const newCostAmount = ref('');

    async function loadDashboard(force = false, projectKey = selectedProject.value) {
      loading.value = true;
      error.value = '';
      try {
        const params = { project: projectKey };
        if (force) params.refresh = 'true';
        if (financeMonth.value) params.finance_month = financeMonth.value;
        const response = await api.get('/ulttra-dashboard', {
          params,
        });
        payload.value = prepareDashboardPayload(response.data);
        selectedProject.value = response.data?.selected_project || projectKey;
        financeMonth.value = response.data?.metrics?.manual_finance?.month_key || financeMonth.value;
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

    function validateInviteNameValue(value) {
      return emailInTextPattern.test(String(value || '').trim())
        ? 'Invitee name must be a name, not an email address.'
        : '';
    }

    function validateInviteEmailValue(value) {
      const cleanedEmail = String(value || '').trim().toLowerCase();
      return cleanedEmail && !emailPattern.test(cleanedEmail)
        ? 'Enter a valid invitee email address.'
        : '';
    }

    function updateInviteName(value) {
      inviteName.value = value;
      inviteNameError.value = validateInviteNameValue(value);
      if (inviteNameError.value) {
        inviteMessage.value = '';
        inviteSuccess.value = false;
        inviteStatus.value = 'ERROR';
      }
    }

    function updateInviteEmail(value) {
      inviteEmail.value = value;
      inviteEmailError.value = validateInviteEmailValue(value);
      if (inviteEmailError.value) {
        inviteMessage.value = '';
        inviteSuccess.value = false;
        inviteStatus.value = 'ERROR';
      }
    }

    async function submitInvite() {
      inviteMessage.value = '';
      inviteSuccess.value = false;
      inviteStatus.value = '';
      const cleanedName = String(inviteName.value || '').trim();
      const cleanedEmail = String(inviteEmail.value || '').trim().toLowerCase();
      inviteNameError.value = validateInviteNameValue(cleanedName);
      inviteEmailError.value = validateInviteEmailValue(cleanedEmail) || (!cleanedEmail ? 'Enter a valid invitee email address.' : '');
      if (inviteNameError.value) {
        inviteStatus.value = 'ERROR';
        inviteMessage.value = inviteNameError.value;
        return;
      }
      if (inviteEmailError.value) {
        inviteStatus.value = 'ERROR';
        inviteMessage.value = inviteEmailError.value;
        return;
      }
      inviteBusy.value = true;
      try {
        const response = await api.post('/ulttra-dashboard/founder-invite', {
          invited_name: cleanedName,
          invited_email: cleanedEmail,
        });
        inviteStatus.value = response.data?.status || 'ERROR';
        inviteSuccess.value = response.data?.status === 'SENT';
        inviteMessage.value = response.data?.message || 'Invitation request processed.';
        if (response.data?.status === 'SENT') {
          inviteName.value = '';
          inviteEmail.value = '';
          inviteNameError.value = '';
          inviteEmailError.value = '';
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

    async function submitRegisteredFounderInvite(candidate) {
      if (!candidate?.id || candidate.already_invited) return;
      registeredInviteBusyLeadId.value = candidate.id;
      registeredInviteMessage.value = '';
      registeredInviteSuccess.value = false;
      try {
        const response = await api.post('/ulttra-dashboard/registered-founder-invite', {
          lead_id: candidate.id,
        });
        registeredInviteSuccess.value = response.data?.status === 'SENT';
        registeredInviteMessage.value = response.data?.message || 'Founder invitation request processed.';
        await loadDashboard(true);
      } catch (err) {
        registeredInviteSuccess.value = false;
        registeredInviteMessage.value = err?.response?.data?.message || 'Founder invitation could not be created.';
      } finally {
        registeredInviteBusyLeadId.value = '';
      }
    }

    async function toggleRegisteredFounderExclusion(candidate, excluded) {
      if (!candidate?.id || candidate.synthetic_test) return;
      registeredExcludeBusyLeadId.value = candidate.id;
      registeredInviteMessage.value = '';
      registeredInviteSuccess.value = false;
      try {
        const response = await api.post('/ulttra-dashboard/registered-founder-exclusion', {
          lead_id: candidate.id,
          excluded,
        });
        registeredInviteSuccess.value = true;
        registeredInviteMessage.value = response.data?.message || 'Founder invite list updated.';
        await loadDashboard(true);
      } catch (err) {
        registeredInviteSuccess.value = false;
        registeredInviteMessage.value = err?.response?.data?.message || 'Founder invite list could not be updated.';
      } finally {
        registeredExcludeBusyLeadId.value = '';
      }
    }

    function selectProject(projectKey) {
      if (!projectKey || projectKey === selectedProject.value) return;
      selectedProject.value = projectKey;
      tierDetailOpen.value = false;
      selectedPriorityMemberId.value = '';
      loadDashboard(false, projectKey);
    }

    async function changeFinanceMonth(monthKey) {
      financeMonth.value = monthKey;
      await loadDashboard(true);
    }

    async function createCostCategory() {
      await runFinanceAction(async () => {
        const finance = payload.value?.metrics?.manual_finance || {};
        await api.post('/ulttra-dashboard/finance/categories', {
          project_key: finance.project_key || selectedProject.value,
          month_key: finance.month_key || financeMonth.value,
          name: newCostName.value,
          amount: newCostAmount.value,
        });
        newCostName.value = '';
        newCostAmount.value = '';
      });
    }

    async function saveCostCategory(category) {
      await runFinanceAction(async () => {
        const finance = payload.value?.metrics?.manual_finance || {};
        await api.patch(`/ulttra-dashboard/finance/categories/${category.id}`, {
          project_key: finance.project_key || selectedProject.value,
          month_key: finance.month_key || financeMonth.value,
          name: category.draft_name,
        });
      });
    }

    async function saveCostAmount(category) {
      await runFinanceAction(async () => {
        const finance = payload.value?.metrics?.manual_finance || {};
        await api.put('/ulttra-dashboard/finance/costs', {
          project_key: finance.project_key || selectedProject.value,
          month_key: finance.month_key || financeMonth.value,
          category_id: category.id,
          amount: category.draft_amount,
        });
      });
    }

    async function removeCostCategory(category) {
      await runFinanceAction(async () => {
        const finance = payload.value?.metrics?.manual_finance || {};
        await api.delete(`/ulttra-dashboard/finance/categories/${category.id}`, {
          params: {
            project_key: finance.project_key || selectedProject.value,
            month_key: finance.month_key || financeMonth.value,
          },
        });
      });
    }

    async function saveRevenueGoal(periodType) {
      await runFinanceAction(async () => {
        const finance = payload.value?.metrics?.manual_finance || {};
        const goal = finance.goals?.[periodType] || {};
        await api.put('/ulttra-dashboard/finance/goals', {
          project_key: finance.project_key || selectedProject.value,
          month_key: finance.month_key || financeMonth.value,
          period_type: periodType,
          period_key: goal.period_key,
          amount: goal.draft_amount,
        });
      });
    }

    async function runFinanceAction(action) {
      financeBusy.value = true;
      financeMessage.value = '';
      try {
        await action();
        await loadDashboard(true);
        financeMessage.value = 'Financial values saved.';
      } catch (err) {
        financeMessage.value = err?.response?.data?.error || err?.response?.data?.message || 'Financial values could not be saved.';
      } finally {
        financeBusy.value = false;
      }
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
      inviteNameError,
      inviteEmailError,
      inviteCooldownRemaining,
      presttigeInviteEmail,
      presttigeInviteBusy,
      presttigeInviteMessage,
      presttigeInviteSuccess,
      registeredInviteBusyLeadId,
      registeredExcludeBusyLeadId,
      registeredInviteMessage,
      registeredInviteSuccess,
      tierDetailOpen,
      selectedPriorityMemberId,
      selectedProject,
      financeMonth,
      financeBusy,
      financeMessage,
      newCostName,
      newCostAmount,
      loadDashboard,
      selectProject,
      submitInvite,
      updateInviteName,
      updateInviteEmail,
      submitPresttigeInvitation,
      submitRegisteredFounderInvite,
      toggleRegisteredFounderExclusion,
      changeFinanceMonth,
      createCostCategory,
      saveCostCategory,
      saveCostAmount,
      removeCostCategory,
      saveRevenueGoal,
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
      data.current_user?.is_chairman && metrics.manual_finance ? manualFinanceSection({
        finance: metrics.manual_finance,
        busy: this.financeBusy,
        message: this.financeMessage,
        newCostName: this.newCostName,
        newCostAmount: this.newCostAmount,
        updateNewCostName: (value) => { this.newCostName = value; },
        updateNewCostAmount: (value) => { this.newCostAmount = value; },
        changeMonth: (value) => this.changeFinanceMonth(value),
        createCategory: () => this.createCostCategory(),
        saveCategory: (category) => this.saveCostCategory(category),
        saveAmount: (category) => this.saveCostAmount(category),
        removeCategory: (category) => this.removeCostCategory(category),
        saveGoal: (periodType) => this.saveRevenueGoal(periodType),
      }) : null,
      analyticsSection(metrics),
      founderPatronMembersSection(metrics.priority_members || [], this.selectedPriorityMemberId, (memberId) => {
        this.selectedPriorityMemberId = this.selectedPriorityMemberId === memberId ? '' : memberId;
      }),
      data.current_user?.is_chairman ? registeredFounderInviteSection({
        candidates: metrics.registered_founder_candidates || [],
        exclusions: metrics.registered_founder_exclusions || [],
        busyLeadId: this.registeredInviteBusyLeadId,
        excludeBusyLeadId: this.registeredExcludeBusyLeadId,
        message: this.registeredInviteMessage,
        success: this.registeredInviteSuccess,
        submit: (candidate) => this.submitRegisteredFounderInvite(candidate),
        toggleExclude: (candidate, excluded) => this.toggleRegisteredFounderExclusion(candidate, excluded),
      }) : null,
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
            fieldInput('Invitee name', this.inviteName, this.updateInviteName, 'text', {
              name: 'invited_name',
              autocomplete: 'name',
              error: this.inviteNameError,
              onBlur: () => { this.updateInviteName(this.inviteName); },
              required: true,
            }),
            fieldInput('Invitee email', this.inviteEmail, this.updateInviteEmail, 'email', {
              name: 'invited_email',
              autocomplete: 'email',
              pattern: '[^\\s@]+@[^\\s@]+\\.[^\\s@]+',
              error: this.inviteEmailError,
              onBlur: () => { this.updateInviteEmail(this.inviteEmail); },
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

function prepareDashboardPayload(data) {
  const finance = data?.metrics?.manual_finance;
  if (!finance) return data;
  finance.categories = (finance.categories || []).map((category) => ({
    ...category,
    draft_name: category.draft_name ?? category.name ?? '',
    draft_amount: category.draft_amount ?? centsToAmountInput(category.amount_cents),
  }));
  finance.goals = finance.goals || {};
  for (const key of ['month', 'year']) {
    if (finance.goals[key]) {
      finance.goals[key].draft_amount = finance.goals[key].draft_amount ?? centsToAmountInput(finance.goals[key].amount_cents);
    }
  }
  return data;
}

function centsToAmountInput(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
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

function registeredFounderInviteSection({ candidates, exclusions, busyLeadId, excludeBusyLeadId, message, success, submit, toggleExclude }) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const excludedRows = Array.isArray(exclusions) ? exclusions : [];
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
        h('h2', { style: { margin: '0 0 6px', fontSize: '22px' } }, 'Become a Founder'),
        h('p', { style: { margin: 0, color: 'var(--theme--foreground-subdued)' } }, 'Invite registered Presttige people from the list.'),
      ]),
      h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px', whiteSpace: 'nowrap' } }, `${rows.length} listed`),
    ]),
    rows.length ? h('div', {
      style: {
        overflowX: 'auto',
        overflowY: 'auto',
        maxHeight: '292px',
        border: '1px solid var(--theme--border-color)',
        borderRadius: '8px',
      },
    }, [
      h('table', {
        style: {
          width: '100%',
          minWidth: '860px',
          borderCollapse: 'collapse',
        },
      }, [
        h('thead', null, [
          h('tr', null, [
            founderCandidateHeader('Exclude'),
            founderCandidateHeader('Name'),
            founderCandidateHeader('Email'),
            founderCandidateHeader('Location'),
            founderCandidateHeader('Tier Status'),
            founderCandidateHeader(''),
          ]),
        ]),
        h('tbody', null, rows.map((candidate) => {
          const busy = busyLeadId === candidate.id;
          const disabled = busy || candidate.already_invited;
          const excludeBusy = excludeBusyLeadId === candidate.id;
          return h('tr', { key: candidate.id }, [
            founderCandidateCell(h('input', {
              type: 'checkbox',
              checked: false,
              disabled: Boolean(candidate.synthetic_test) || excludeBusy,
              title: candidate.synthetic_test ? 'Synthetic test records stay visible.' : 'Hide from this list',
              style: {
                width: '16px',
                height: '16px',
                margin: 0,
                accentColor: 'var(--theme--primary)',
                cursor: candidate.synthetic_test || excludeBusy ? 'not-allowed' : 'pointer',
              },
              onChange: () => toggleExclude(candidate, true),
            }), 'center'),
            founderCandidateCell(h('strong', { style: { color: 'var(--theme--foreground)', fontWeight: 600 } }, candidate.name || 'Unnamed')),
            founderCandidateCell(candidate.email || ''),
            founderCandidateCell(candidate.location || [candidate.city, candidate.country].filter(Boolean).join(', ')),
            founderCandidateCell([
              tierLabel(candidate.tier || 'free'),
              candidate.synthetic_test ? h('span', {
                style: {
                  marginLeft: '8px',
                  color: 'var(--theme--primary)',
                  fontSize: '12px',
                  whiteSpace: 'nowrap',
                },
              }, 'synthetic') : null,
            ]),
            founderCandidateCell(h('button', {
              type: 'button',
              class: 'button',
              disabled,
              style: {
                minHeight: '36px',
                whiteSpace: 'nowrap',
              },
              onClick: () => submit(candidate),
            }, candidate.already_invited ? 'Already invited' : busy ? 'Sending' : 'Invite Founder'), 'right'),
          ]);
        })),
      ]),
    ]) : h('p', {
      style: {
        margin: 0,
        color: 'var(--theme--foreground-subdued)',
      },
    }, 'No registered people currently match the invite criteria.'),
    excludedRows.length ? h('details', {
      style: {
        marginTop: '14px',
        borderTop: '1px solid var(--theme--border-color)',
        paddingTop: '14px',
      },
    }, [
      h('summary', {
        style: {
          cursor: 'pointer',
          color: 'var(--theme--foreground-subdued)',
          fontSize: '13px',
          fontWeight: 600,
        },
      }, `Excluded from this list (${excludedRows.length})`),
      h('div', {
        style: {
          display: 'grid',
          gap: '10px',
          marginTop: '12px',
        },
      }, excludedRows.map((candidate) => h('div', {
        key: `excluded-${candidate.id}`,
        style: {
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 0',
          borderBottom: '1px solid var(--theme--border-color)',
        },
      }, [
        h('strong', { style: { color: 'var(--theme--foreground)', fontWeight: 600 } }, candidate.name || 'Unnamed'),
        h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, candidate.email || ''),
        h('button', {
          type: 'button',
          class: 'button',
          disabled: excludeBusyLeadId === candidate.id,
          style: {
            minHeight: '34px',
            whiteSpace: 'nowrap',
          },
          onClick: () => toggleExclude(candidate, false),
        }, excludeBusyLeadId === candidate.id ? 'Restoring' : 'Restore'),
      ]))),
    ]) : null,
    message ? h('p', {
      style: {
        margin: '14px 0 0',
        color: success ? 'var(--success)' : 'var(--theme--foreground-subdued)',
      },
    }, message) : null,
  ]);
}

function founderCandidateHeader(label) {
  return h('th', {
    style: {
      textAlign: label ? 'left' : 'right',
      padding: '11px 12px',
      borderBottom: '1px solid var(--theme--border-color)',
      color: 'var(--theme--foreground-subdued)',
      fontSize: '12px',
      fontWeight: 700,
    },
  }, label);
}

function founderCandidateCell(content, align = 'left') {
  return h('td', {
    style: {
      textAlign: align,
      padding: '12px',
      borderBottom: '1px solid var(--theme--border-color)',
      color: 'var(--theme--foreground-subdued)',
      fontSize: '13px',
      verticalAlign: 'middle',
    },
  }, content);
}

function tierLabel(tier) {
  const value = String(tier || 'free').toLowerCase();
  if (value === 'club') return 'Club';
  if (value === 'premier') return 'Premier';
  if (value === 'patron') return 'Patron';
  return 'free';
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

function manualFinanceSection({
  finance,
  busy,
  message,
  newCostName,
  newCostAmount,
  updateNewCostName,
  updateNewCostAmount,
  changeMonth,
  createCategory,
  saveCategory,
  saveAmount,
  removeCategory,
  saveGoal,
}) {
  return h('section', {
    style: {
      border: '1px solid var(--theme--border-color)',
      borderRadius: '8px',
      padding: '24px',
      background: 'var(--theme--background)',
      marginBottom: '28px',
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
        h('h2', { style: { margin: '0 0 6px', fontSize: '22px' } }, 'Costs, goals, profit'),
        h('p', { style: { margin: 0, color: 'var(--theme--foreground-subdued)' } }, finance.scope_note || 'Manual financial values for this dashboard tab.'),
      ]),
      h('label', {
        style: {
          display: 'grid',
          gap: '6px',
          minWidth: '160px',
        },
      }, [
        h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '12px' } }, 'Month'),
        h('input', {
          type: 'month',
          value: finance.month_key,
          disabled: busy,
          style: inputStyle(),
          onChange: (event) => changeMonth(event.target.value),
        }),
      ]),
    ]),
    h('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '16px',
        marginBottom: '20px',
      },
    }, [
      financeSummaryCard('Revenue', finance.revenue_month_display || '$0.00', `Existing dashboard revenue, ${finance.month_key}`),
      financeSummaryCard('Costs', finance.total_costs_display || '$0.00', 'AWS automatic plus manual categories'),
      financeSummaryCard('Profit', finance.profit_month_display || '$0.00', 'Revenue minus costs', Number(finance.profit_month_cents || 0)),
      goalCard('Month goal', finance.goals?.month, () => saveGoal('month'), busy),
      goalCard('Year goal', finance.goals?.year, () => saveGoal('year'), busy),
    ]),
    h('div', {
      style: {
        display: 'grid',
        gap: '12px',
      },
    }, [
      h('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '12px',
        alignItems: 'end',
      },
      }, [
        fieldInput('New cost category', newCostName, updateNewCostName, 'text', {
          name: 'new_cost_category',
          autocomplete: 'off',
        }),
        amountField('Monthly value', newCostAmount, updateNewCostAmount, busy),
        h('button', {
          class: 'button',
          type: 'button',
          disabled: busy || !newCostName,
          style: {
            minHeight: '44px',
            whiteSpace: 'nowrap',
          },
          onClick: createCategory,
        }, busy ? 'Saving' : 'Add cost'),
      ]),
      autoAwsCostRow(finance.aws_cost),
      finance.categories?.length ? h('div', {
        style: {
          display: 'grid',
          gap: '8px',
        },
      }, finance.categories.map((category) => costCategoryRow({
        category,
        busy,
        saveCategory,
        saveAmount,
        removeCategory,
      }))) : h('div', {
        style: {
          border: '1px solid var(--theme--border-color)',
          borderRadius: '8px',
          padding: '18px',
          color: 'var(--theme--foreground-subdued)',
        },
      }, 'No cost categories yet'),
    ]),
    message ? h('p', {
      style: {
        margin: '14px 0 0',
        color: message.includes('could not') ? 'var(--danger)' : 'var(--success)',
      },
    }, message) : null,
  ]);
}

function financeSummaryCard(label, value, detail, signedValue = null) {
  const color = signedValue == null
    ? 'var(--theme--foreground)'
    : signedValue < 0
      ? 'var(--danger)'
      : 'var(--success)';
  return h('article', { style: { ...cardStyle, minHeight: '112px' } }, [
    h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, label),
    h('strong', { style: { fontSize: '30px', lineHeight: '36px', color } }, value),
    h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, detail),
  ]);
}

function autoAwsCostRow(awsCost) {
  if (!awsCost) return null;
  return h('div', {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(180px, 1fr) minmax(140px, 180px) minmax(220px, 1fr)',
      gap: '10px',
      alignItems: 'center',
      border: '1px solid var(--theme--border-color)',
      borderRadius: '8px',
      padding: '12px',
      background: 'var(--theme--background-subdued, var(--theme--background))',
    },
  }, [
    h('div', [
      h('span', { style: { display: 'block', color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, 'Automatic cost'),
      h('strong', { style: { fontSize: '16px' } }, awsCost.name || 'AWS'),
    ]),
    h('div', [
      h('span', { style: { display: 'block', color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, 'Month-to-date'),
      h('strong', { style: { fontSize: '16px' } }, awsCost.amount_display || '$0.00'),
    ]),
    h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, `${awsCost.period_start || ''} to ${awsCost.period_end || ''}${awsCost.estimated ? ', estimated' : ''}`),
  ]);
}

function goalCard(label, goal, save, busy) {
  const progress = Number(goal?.progress_percent || 0);
  return h('article', { style: { ...cardStyle, minHeight: '112px' } }, [
    h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, label),
    h('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: '10px',
        alignItems: 'end',
      },
    }, [
      amountField('Revenue goal', goal?.draft_amount || '0.00', (value) => { goal.draft_amount = value; }, busy),
      h('button', {
        class: 'button',
        type: 'button',
        disabled: busy,
        style: {
          minHeight: '44px',
        },
        onClick: save,
      }, 'Save'),
    ]),
    h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, `${goal?.actual_display || '$0.00'} actual, ${progress}%`),
    h('div', {
      style: {
        height: '6px',
        borderRadius: '999px',
        background: 'var(--theme--background-subdued, var(--theme--border-color))',
        overflow: 'hidden',
      },
    }, [
      h('div', {
        style: {
          width: `${Math.max(0, Math.min(progress, 100))}%`,
          height: '100%',
          background: 'var(--theme--foreground-accent)',
        },
      }),
    ]),
  ]);
}

function costCategoryRow({ category, busy, saveCategory, saveAmount, removeCategory }) {
  return h('div', {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: '10px',
      alignItems: 'end',
      border: '1px solid var(--theme--border-color)',
      borderRadius: '8px',
      padding: '12px',
    },
  }, [
    fieldInput('Category', category.draft_name, (value) => { category.draft_name = value; }, 'text', {
      name: `cost_category_${category.id}`,
      autocomplete: 'off',
      required: true,
    }),
    amountField('Monthly cost', category.draft_amount, (value) => { category.draft_amount = value; }, busy),
    h('button', {
      class: 'button',
      type: 'button',
      disabled: busy || !category.draft_name,
      style: { minHeight: '44px' },
      onClick: () => saveCategory(category),
    }, 'Rename'),
    h('button', {
      class: 'button',
      type: 'button',
      disabled: busy,
      style: { minHeight: '44px' },
      onClick: () => saveAmount(category),
    }, 'Save value'),
    h('button', {
      class: 'button',
      type: 'button',
      disabled: busy,
      style: { minHeight: '44px' },
      onClick: () => removeCategory(category),
    }, 'Remove'),
  ]);
}

function amountField(label, value, update, disabled) {
  return h('label', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, [
    h('span', { style: { color: 'var(--theme--foreground-subdued)', fontSize: '13px' } }, label),
    h('input', {
      type: 'number',
      min: '0',
      step: '0.01',
      value,
      disabled,
      style: inputStyle(),
      onInput: (event) => update(event.target.value),
    }),
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
      pattern: options.pattern,
      style: inputStyle(Boolean(options.error)),
      onInput: (event) => update(event.target.value),
      onBlur: options.onBlur,
    }),
    options.error ? h('span', {
      style: {
        color: 'var(--danger)',
        fontSize: '12px',
        lineHeight: '1.35',
      },
    }, options.error) : null,
  ]);
}

function inputStyle(hasError = false) {
  return {
    height: '44px',
    borderRadius: '6px',
    border: hasError ? '1px solid var(--danger)' : '1px solid var(--theme--border-color)',
    padding: '0 12px',
    background: 'var(--theme--form--field--input--background)',
    color: 'var(--theme--foreground)',
  };
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
