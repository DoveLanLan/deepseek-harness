/**
 * Browser half of the provider quota popup: one extension row inside a provider
 * card in Models settings, with a dialog that shows the usage windows the Host
 * route projects.
 *
 * Built artifact of a profile bundle, so it is plain JavaScript in the
 * `window.__ModuleLoader__.load` format rather than a compiled module. Only
 * `react` and `react-dom` come from the shared module table; the rows, the
 * dialog, the progress bars, and every control are written here against the
 * host's theme tokens, so no Harness Client package is loaded and no version
 * drift can blank the card.
 *
 * The provider-card slot is keyed by settings namespace, so every pi-ai card
 * dispatches to one cell: this bundle registers that single cell and decides per
 * card which providers it serves.
 *
 * The dialog restates the host Modal recipe rather than importing it, because a
 * plugin cannot load another plugin's components: mask fade, centered card,
 * Escape dismissal, Tab containment inside the card, and focus returned to the
 * trigger on close.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-provider-usage',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement

    /** Dictionary namespace owned by this bundle. */
    const NS = 'provider.usage'
    /** Authenticated Host route, document-relative so a mount proxy works. */
    const ROUTE = 'api/provider-quota'
    /** Provider route ids this bundle serves; the Host refuses any other id. */
    const PROVIDERS = ['clinepass', 'volces']
    /** The settings namespace every pi-ai provider card dispatches this slot with. */
    const SETTINGS_NS = 'llm-pi-ai'
    /** Usage at or above this share is shown as a warning. */
    const WARN_AT = 75
    /** Focusable controls, mirroring the host modal's traversal set. */
    const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'

    /** Popup copy, keyed by built-in locale. */
    const LOCALES = {
      en: {
        rowTitle: 'Usage limits',
        rowHint: '5-hour, weekly, and monthly quota usage',
        action: 'Check usage',
        dialogTitle: 'Usage limits',
        refresh: 'Refresh',
        close: 'Close',
        retry: 'Retry',
        loading: 'Querying usage…',
        limitFiveHour: '5-hour',
        limitWeekly: 'Weekly',
        limitMonthly: 'Monthly',
        remaining: '{value}% left',
        used: '{value}% used',
        resetDue: 'Resetting now',
        resetInMinutes: 'Resets in {count} min',
        resetInHours: 'Resets in {count} h',
        resetInDays: 'Resets in {count} d',
        resetUnknown: 'Reset time unknown',
        noLimits: 'No usage windows were reported for this account.',
        planLabel: 'Plan',
        accountLabel: 'Account',
        periodEndLabel: 'Current period ends',
        updated: 'Queried',
        empty: '—',
        planCodingPlan: 'Coding Plan',
        hintNoSource: 'This deployment configures no quota source for this provider.',
        hintNoKey: 'The credential this provider queries with is not configured.',
        hintAuth: 'The provider rejected the credential (401/403). Check that it is still valid.',
        hintRateLimited: 'The provider is throttling queries right now; try again shortly.',
        hintArkcliMissing: 'The arkcli command is unavailable; install it with "npm i -g @volcengine/ark-cli" or point the plugin at its absolute path.',
        hintNotLoggedIn: 'arkcli is not logged in; run "arkcli auth login volc-sso" once and retry.',
        hintNoSubscription: 'This account has no active subscription for the plan being queried.',
        tokensTitle: 'Tokens',
        tokensLoading: 'Counting tokens…',
        tokensMonth: 'This month',
        tokensLifetime: 'All time',
        tokensSince: 'since {date}',
        tokensPartial: 'at least — part of the history could not be read',
        tokensNone: 'No token usage was reported for this account.',
        tokensPlatformNote: 'ARK meters Coding Plan use as a share of an allowance, so these are the platform pay-as-you-go tokens.',
      },
      zh: {
        rowTitle: '使用额度',
        rowHint: '5 小时、每周、每月的额度用量',
        action: '查询额度',
        dialogTitle: '使用额度',
        refresh: '刷新',
        close: '关闭',
        retry: '重试',
        loading: '正在查询额度…',
        limitFiveHour: '5 小时',
        limitWeekly: '每周',
        limitMonthly: '每月',
        remaining: '剩余 {value}%',
        used: '已用 {value}%',
        resetDue: '即将重置',
        resetInMinutes: '{count} 分钟后重置',
        resetInHours: '{count} 小时后重置',
        resetInDays: '{count} 天后重置',
        resetUnknown: '重置时间未知',
        noLimits: '该账户没有返回可显示的额度窗口。',
        planLabel: '套餐',
        accountLabel: '账户',
        periodEndLabel: '本期结束',
        updated: '查询时间',
        empty: '—',
        planCodingPlan: 'Coding Plan',
        hintNoSource: '该部署没有为这个 provider 配置额度来源。',
        hintNoKey: '该 provider 用于查询的凭据尚未配置。',
        hintAuth: 'provider 拒绝了凭据（401/403），请确认它仍然有效。',
        hintRateLimited: 'provider 暂时限制了查询频率，请稍后重试。',
        hintArkcliMissing: '找不到 arkcli 命令；请执行 "npm i -g @volcengine/ark-cli"，或把插件配置指向它的绝对路径。',
        hintNotLoggedIn: 'arkcli 尚未登录；先执行一次 "arkcli auth login volc-sso" 再重试。',
        hintNoSubscription: '该账号没有查询中套餐的有效订阅。',
        tokensTitle: 'Token 用量',
        tokensLoading: '正在统计 Token…',
        tokensMonth: '本月',
        tokensLifetime: '累计',
        tokensSince: '自 {date}',
        tokensPartial: '至少，部分历史未读到',
        tokensNone: '该账户没有返回可统计的 Token。',
        tokensPlatformNote: 'ARK 的 Coding Plan 以额度百分比计量，这里显示的是平台按量 Token。',
      },
    }

    /** Dialog and row styling, on host theme tokens only. */
    const CSS = `
.dpqRow{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;padding:10px 12px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
.dpqRowText{display:flex;flex-direction:column;gap:2px;min-width:0}
.dpqRowTitle{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.dpqRowHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dpqButton{flex:none;height:28px;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:16px;cursor:pointer}
.dpqButton:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dpqButton:focus-visible{outline:none;border-color:var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary)) 18%,transparent)}
.dpqButton[disabled]{opacity:.5;cursor:default}
.dpqRoot{pointer-events:auto;position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:max(24px,var(--dsh-frame-overlay-top,24px)) 24px}
.dpqMask{position:absolute;inset:var(--dsh-frame-chrome-top,0px) 0 0;backdrop-filter:var(--dsw-mask-blur)}
.dpqMask::after{content:'';position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);animation:dpqEnter var(--ds-transition-duration) var(--ds-ease-in-out)}
.dpqDialog{box-sizing:border-box;position:relative;z-index:1;display:flex;flex-direction:column;gap:18px;width:min(420px,100%);max-height:100%;padding:0 0 20px;overflow:auto;border:0;border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);animation:dpqEnter var(--ds-transition-duration) var(--ds-ease-in-out)}
.dpqDialog:focus{outline:none}
@keyframes dpqEnter{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.dpqMask::after,.dpqDialog{animation:none}}
.dpqHeader{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:18px 14px 10px 20px}
.dpqTitle{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dpqClose{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:14px;line-height:1}
.dpqClose:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dpqBody{display:flex;flex-direction:column;gap:12px;padding:0 20px}
.dpqWindow{display:flex;flex-direction:column;gap:8px;padding:12px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
.dpqWindowHead{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.dpqWindowName{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.dpqRemaining{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dpqTrack{position:relative;height:6px;border-radius:999px;background:var(--dsw-alias-border-l2);overflow:hidden}
.dpqFill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-state-success-primary);transition:width var(--ds-transition-duration) var(--ds-ease-in-out)}
.dpqWindow[data-status='warning'] .dpqFill{background:var(--dsw-alias-state-warn-primary)}
.dpqWindow[data-status='reached'] .dpqFill{background:var(--dsw-alias-state-error-primary)}
@media (prefers-reduced-motion:reduce){.dpqFill{transition:none}}
.dpqWindowMeta{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dpqReset{display:inline-flex;align-items:center;gap:4px}
.dpqFacts{display:flex;flex-direction:column;gap:8px;margin:0}
.dpqTokens{display:flex;flex-direction:column;gap:8px;padding:12px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
.dpqTokensTitle{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.dpqTokensBody{display:flex;flex-direction:column;gap:8px}
.dpqFact{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.dpqFactLabel{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dpqFactValue{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);text-align:right;word-break:break-word}
.dpqError{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary);word-break:break-word}
.dpqMuted{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.dpqMeta{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dpqFooter{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 20px}
.dpqSpinnerWrap{display:flex;justify-content:center;padding:20px 0}
.dpqSpinner{width:18px;height:18px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-secondary);border-radius:50%;animation:dpqSpin 700ms linear infinite}
@keyframes dpqSpin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.dpqSpinner{animation:none}}
`

    /**
     * Insert this bundle's stylesheet.
     * @returns the cleanup removing it.
     */
    function installStyles() {
      const tag = document.createElement('style')
      tag.dataset.plugin = '@local/dsh-provider-usage'
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    /**
     * Name one quota window.
     * @param id - the window id the Host projected.
     * @param t - the bundle's translate seat.
     * @returns the localized name, or the raw id for a window this bundle does not know.
     */
    function windowName(id, t) {
      if (id === 'five_hour') return t('limitFiveHour')
      if (id === 'weekly') return t('limitWeekly')
      if (id === 'monthly') return t('limitMonthly')
      return id
    }

    /**
     * Describe when a window resets, in the coarsest unit that stays precise.
     * @param window - the projected window.
     * @param t - the bundle's translate seat.
     * @returns the localized countdown.
     */
    function resetLabel(window, t) {
      if (window.resetsSoon === true) return t('resetDue')
      if (typeof window.resetsAt !== 'string' || window.resetsAt === '') return t('resetUnknown')
      const at = new Date(window.resetsAt).getTime()
      if (Number.isNaN(at)) return t('resetUnknown')
      const minutes = Math.ceil((at - Date.now()) / 60_000)
      if (minutes <= 0) return t('resetDue')
      if (minutes < 60) return t('resetInMinutes', { count: minutes })
      const hours = Math.ceil(minutes / 60)
      if (hours < 48) return t('resetInHours', { count: hours })
      return t('resetInDays', { count: Math.ceil(hours / 24) })
    }

    /**
     * Render an ISO timestamp in the browser's locale.
     * @param iso - the timestamp, or null.
     * @returns the localized moment, or null when there is none to show.
     */
    function formatMoment(iso) {
      if (typeof iso !== 'string' || iso === '') return null
      const moment = new Date(iso)
      return Number.isNaN(moment.getTime()) ? null : moment.toLocaleString()
    }

    /**
     * Name the subscription the windows belong to. A source that reports the
     * vendor's own plan name has it passed through; an ARK Coding Plan snapshot
     * carries only the product and tier, which are composed here so the copy
     * stays in the dictionary.
     * @param plan - the projected plan facts, or null.
     * @param t - the bundle's translate seat.
     * @returns the localized plan name, or null when the source reported none.
     */
    function planName(plan, t) {
      if (plan === null) return null
      if (typeof plan.name === 'string' && plan.name !== '') return plan.name
      if (plan.product === 'coding-plan') {
        return typeof plan.tier === 'string' && plan.tier !== ''
          ? `${t('planCodingPlan')} ${plan.tier.replace(/^./, first => first.toUpperCase())}`
          : t('planCodingPlan')
      }
      return null
    }

    /**
     * Describe a thrown value for the dialog.
     * @param error - the thrown value.
     * @returns a message naming the failure.
     */
    function describeError(error) {
      if (error instanceof Error && error.message !== '') return error.message
      return String(error)
    }

    /**
     * Read the Host route once.
     * @param provider - the provider route id whose card asked.
     * @param signal - abort signal tied to the dialog's lifetime.
     * @returns the state to render: ready with the projection, or an error.
     */
    async function fetchQuota(provider, signal) {
      const response = await fetch(`${ROUTE}?provider=${encodeURIComponent(provider)}`, {
        signal,
        headers: { accept: 'application/json' },
      })
      const text = await response.text()
      let parsed
      try {
        parsed = text.trim() === '' ? undefined : JSON.parse(text)
      } catch {
        // A non-JSON body is reported through its status, which is the only fact
        // such a response carries.
        parsed = undefined
      }
      if (parsed === null || typeof parsed !== 'object' || parsed.ok !== true) {
        return {
          phase: 'error',
          code: parsed !== null && typeof parsed === 'object' ? parsed.code : undefined,
          message: parsed !== null && typeof parsed === 'object' && typeof parsed.error === 'string' && parsed.error !== ''
            ? parsed.error
            : `HTTP ${response.status}`,
        }
      }
      return { phase: 'ready', value: parsed }
    }

    /**
     * Read the Host route's token projection once. It is a separate request
     * because a lifetime total can cost a walk over many ranges, while the quota
     * windows answer immediately.
     * @param provider - the provider route id whose card asked.
     * @param signal - abort signal tied to the dialog's lifetime.
     * @returns the state to render: ready with the projection, or an error.
     */
    async function fetchTokens(provider, signal) {
      const response = await fetch(`${ROUTE}?provider=${encodeURIComponent(provider)}&tokens=1`, {
        signal,
        headers: { accept: 'application/json' },
      })
      const text = await response.text()
      let parsed
      try {
        parsed = text.trim() === '' ? undefined : JSON.parse(text)
      } catch {
        // A non-JSON body is reported through its status, which is the only fact
        // such a response carries.
        parsed = undefined
      }
      if (parsed === null || typeof parsed !== 'object' || parsed.ok !== true) {
        return {
          phase: 'error',
          message: parsed !== null && typeof parsed === 'object' && typeof parsed.error === 'string' && parsed.error !== ''
            ? parsed.error
            : `HTTP ${response.status}`,
        }
      }
      return { phase: 'ready', value: parsed.tokens }
    }

    /**
     * Render one token count.
     * @param value - the count, or null when the source cannot report it.
     * @returns the formatted count, or null.
     */
    function formatTokens(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null
      return new Intl.NumberFormat(undefined).format(Math.round(value))
    }

    /**
     * The clock beside a reset countdown.
     * @returns the icon.
     */
    function ResetIcon() {
      return h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('circle', { cx: 8, cy: 8, r: 6.1, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', { d: 'M8 4.6V8.2l2.3 1.4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }))
    }

    /**
     * One quota window: its name, the remaining share, a progress bar, and when
     * it resets.
     * @param props.window - the window the Host projected.
     * @param props.t - the bundle's translate seat.
     * @returns the window card.
     */
    function QuotaWindow(props) {
      const { window, t } = props
      const used = typeof window.percentUsed === 'number' && Number.isFinite(window.percentUsed) ? window.percentUsed : 0
      const remaining = Math.max(0, 100 - used)
      const status = used >= 100 ? 'reached' : used >= WARN_AT ? 'warning' : 'healthy'
      const name = windowName(window.id, t)
      const absolute = formatMoment(window.resetsAt)
      return h('div', { className: 'dpqWindow', 'data-status': status },
        h('div', { className: 'dpqWindowHead' },
          h('span', { className: 'dpqWindowName' }, name),
          h('span', { className: 'dpqRemaining' }, t('remaining', { value: Math.round(remaining) }))),
        h('div', {
          className: 'dpqTrack',
          role: 'progressbar',
          'aria-label': name,
          'aria-valuemin': 0,
          'aria-valuemax': 100,
          'aria-valuenow': Math.round(used),
        }, h('span', { className: 'dpqFill', style: { width: `${used}%` } })),
        h('div', { className: 'dpqWindowMeta' },
          h('span', null, t('used', { value: Math.round(used) })),
          h('span', { className: 'dpqReset', title: absolute ?? undefined },
            h(ResetIcon, null),
            resetLabel(window, t))))
    }

    /**
     * One label/value row of the dialog's fact list.
     * @param props.label - the localized label.
     * @param props.value - the already-formatted value.
     * @returns the row.
     */
    function Fact(props) {
      return h('div', { className: 'dpqFact' },
        h('dt', { className: 'dpqFactLabel' }, props.label),
        h('dd', { className: 'dpqFactValue' }, props.value))
    }

    /**
     * The quota dialog: query state, the windows, and modal keyboard ownership
     * (Escape closes, Tab stays inside, focus returns to the trigger).
     * @param props.provider - the provider route id whose card opened it.
     * @param props.t - the bundle's translate seat.
     * @param props.onClose - close command for Escape, the mask, and the buttons.
     * @returns the portaled dialog.
     */
    function QuotaDialog(props) {
      const { provider, t } = props
      const dialogRef = React.useRef(null)
      const close = React.useRef(props.onClose)
      close.current = props.onClose
      const [state, setState] = React.useState({ phase: 'loading' })
      const [tokens, setTokens] = React.useState({ phase: 'loading' })
      const [attempt, setAttempt] = React.useState(0)

      React.useEffect(() => {
        const controller = new AbortController()
        let live = true
        setState({ phase: 'loading' })
        fetchQuota(provider, controller.signal).then(
          next => { if (live) setState(next) },
          error => { if (live) setState({ phase: 'error', message: describeError(error) }) },
        )
        return () => {
          live = false
          controller.abort()
        }
      }, [provider, attempt])

      React.useEffect(() => {
        const controller = new AbortController()
        let live = true
        setTokens({ phase: 'loading' })
        fetchTokens(provider, controller.signal).then(
          next => { if (live) setTokens(next) },
          error => { if (live) setTokens({ phase: 'error', message: describeError(error) }) },
        )
        return () => {
          live = false
          controller.abort()
        }
      }, [provider, attempt])

      React.useEffect(() => {
        const dialog = dialogRef.current
        const previous = document.activeElement
        const initial = dialog === null
          ? null
          : dialog.querySelector('[data-dpq-autofocus]') ?? dialog.querySelector(FOCUSABLE) ?? dialog
        if (initial !== null) initial.focus()
        const onKeyDown = event => {
          if (event.defaultPrevented || event.isComposing) return
          if (event.key === 'Escape' && !event.shiftKey) {
            event.preventDefault()
            close.current()
            return
          }
          if (event.key !== 'Tab' || dialog === null) return
          const items = Array.from(dialog.querySelectorAll(FOCUSABLE))
            .filter(item => item.closest('[inert], [hidden]') === null)
          if (items.length === 0) {
            event.preventDefault()
            dialog.focus()
            return
          }
          // Traversal is explicit rather than left to the browser: the dialog is
          // portaled to the end of the body, so native tab order would leave the
          // card after its last control instead of cycling inside it.
          const index = items.indexOf(document.activeElement)
          const target = event.shiftKey
            ? index <= 0 ? items[items.length - 1] : items[index - 1]
            : index === -1 || index === items.length - 1 ? items[0] : items[index + 1]
          event.preventDefault()
          target.focus()
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown, true)
          if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
        }
      }, [])

      const body = []
      if (state.phase === 'loading') {
        body.push(h('div', { className: 'dpqSpinnerWrap', key: 'loading' },
          h('span', { className: 'dpqSpinner', role: 'progressbar', 'aria-label': t('loading') })))
        body.push(h('p', { className: 'dpqMuted', key: 'loadingText' }, t('loading')))
      } else if (state.phase === 'error') {
        body.push(h('p', { className: 'dpqError', key: 'error' }, state.message))
        const hints = {
          NO_SOURCE: 'hintNoSource',
          NO_KEY: 'hintNoKey',
          AUTH: 'hintAuth',
          RATE_LIMITED: 'hintRateLimited',
          ARKCLI_MISSING: 'hintArkcliMissing',
          NOT_LOGGED_IN: 'hintNotLoggedIn',
          NO_SUBSCRIPTION: 'hintNoSubscription',
        }
        const hintKey = hints[state.code]
        if (hintKey !== undefined) body.push(h('p', { className: 'dpqMuted', key: 'hint' }, t(hintKey)))
      } else {
        const windows = Array.isArray(state.value.windows) ? state.value.windows : []
        if (windows.length === 0) {
          body.push(h('p', { className: 'dpqMuted', key: 'none' }, t('noLimits')))
        } else {
          body.push(h('div', { key: 'windows', style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
            windows.map(window => h(QuotaWindow, { key: String(window.id), window, t }))))
        }
        const plan = state.value.plan === null || typeof state.value.plan !== 'object' ? null : state.value.plan
        const facts = []
        const name = planName(plan, t)
        if (name !== null) facts.push(h(Fact, { key: 'plan', label: t('planLabel'), value: name }))
        if (plan !== null && typeof plan.account === 'string' && plan.account !== '') {
          facts.push(h(Fact, { key: 'account', label: t('accountLabel'), value: plan.account }))
        }
        const periodEnd = plan === null ? null : formatMoment(plan.periodEnd)
        if (periodEnd !== null) facts.push(h(Fact, { key: 'periodEnd', label: t('periodEndLabel'), value: periodEnd }))
        if (facts.length > 0) body.push(h('dl', { className: 'dpqFacts', key: 'facts' }, facts))
        body.push(h('p', { className: 'dpqMeta', key: 'meta' },
          `${t('updated')} ${formatMoment(state.value.fetchedAt) ?? t('empty')}`))
      }

      // Token totals answer on their own request, so a slow lifetime walk never
      // holds the quota windows back and a quota failure still shows token data.
      const tokenFacts = []
      if (tokens.phase === 'loading') {
        tokenFacts.push(h('p', { className: 'dpqMuted', key: 'tokenLoading' }, t('tokensLoading')))
      } else if (tokens.phase === 'error') {
        tokenFacts.push(h('p', { className: 'dpqMuted', key: 'tokenError' }, tokens.message))
      } else {
        const month = formatTokens(tokens.value?.monthToDate)
        const lifetime = formatTokens(tokens.value?.lifetime)
        if (month === null && lifetime === null) {
          tokenFacts.push(h('p', { className: 'dpqMuted', key: 'tokenNone' }, t('tokensNone')))
        } else {
          const partial = tokens.value?.lifetimePartial === true
          const rows = []
          if (month !== null) rows.push(h(Fact, { key: 'month', label: t('tokensMonth'), value: month }))
          if (lifetime !== null) {
            const since = typeof tokens.value?.since === 'string' && tokens.value.since !== ''
              ? ` (${t('tokensSince', { date: tokens.value.since })})`
              : ''
            rows.push(h(Fact, {
              key: 'lifetime',
              label: `${t('tokensLifetime')}${since}`,
              value: partial ? `≥ ${lifetime}` : lifetime,
            }))
          }
          tokenFacts.push(h('dl', { className: 'dpqFacts' }, rows))
          if (partial) tokenFacts.push(h('p', { className: 'dpqMeta', key: 'tokenPartial' }, t('tokensPartial')))
          if (tokens.value?.platformOnly === true) {
            tokenFacts.push(h('p', { className: 'dpqMeta', key: 'tokenPlatform' }, t('tokensPlatformNote')))
          }
        }
      }
      body.push(h('div', { className: 'dpqTokens', key: 'tokens' },
        h('span', { className: 'dpqTokensTitle' }, t('tokensTitle')),
        h('div', { className: 'dpqTokensBody' }, tokenFacts)))

      const footer = []
      if (state.phase !== 'loading') {
        footer.push(h('button', {
          type: 'button',
          className: 'dpqButton',
          key: 'refresh',
          onClick: () => setAttempt(count => count + 1),
        }, t('refresh')))
      }
      footer.push(h('button', {
        type: 'button',
        className: 'dpqButton',
        key: 'close',
        'data-dpq-autofocus': true,
        onClick: () => close.current(),
      }, state.phase === 'error' ? t('retry') : t('close')))

      return createPortal(h('div', { className: 'dpqRoot', role: 'presentation' },
        h('div', { className: 'dpqMask', 'aria-hidden': 'true', onClick: () => close.current() }),
        h('div', {
          ref: dialogRef,
          className: 'dpqDialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('dialogTitle'),
          tabIndex: -1,
        },
        h('div', { className: 'dpqHeader' },
          h('h2', { className: 'dpqTitle' }, t('dialogTitle')),
          h('button', {
            type: 'button',
            className: 'dpqClose',
            'aria-label': t('close'),
            onClick: () => close.current(),
          }, '✕')),
        h('div', { className: 'dpqBody' }, body),
        h('div', { className: 'dpqFooter' }, footer))), document.body)
    }

    /**
     * A provider card's quota row: the trigger, and the dialog it opens.
     *
     * Every pi-ai provider card dispatches this slot with the same key, so the
     * row appears only on the cards of the providers this bundle serves.
     * @param props.provider - the card's directory row.
     * @param props.t - the bundle's translate seat.
     * @returns the row, or null on every other provider card.
     */
    function ProviderQuotaEntry(props) {
      const [open, setOpen] = React.useState(false)
      const provider = props.provider
      if (provider === null || typeof provider !== 'object' || !PROVIDERS.includes(provider.provider)) return null
      const t = props.t
      return h(React.Fragment, null,
        h('div', { className: 'dpqRow' },
          h('div', { className: 'dpqRowText' },
            h('span', { className: 'dpqRowTitle' }, t('rowTitle')),
            h('span', { className: 'dpqRowHint' }, t('rowHint'))),
          h('button', {
            type: 'button',
            className: 'dpqButton',
            'aria-haspopup': 'dialog',
            onClick: () => setOpen(true),
          }, t('action'))),
        open ? h(QuotaDialog, { provider: provider.provider, t, onClose: () => setOpen(false) }) : null)
    }

    /** Required services: keyed slot registration and the dictionaries. */
    const inject = ['slots', 'locale']

    /** Register the stylesheet, both dictionaries, and the provider-card row. */
    function apply(ctx) {
      ctx.effect(installStyles, 'dsh-provider-usage: stylesheet')
      ctx.effect(() => ctx.locale.register(NS, 'en', LOCALES.en), 'dsh-provider-usage: en dictionary')
      ctx.effect(() => ctx.locale.register(NS, 'zh', LOCALES.zh), 'dsh-provider-usage: zh dictionary')
      ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
        name: 'settings.models.provider-card',
        key: SETTINGS_NS,
        locale: NS,
      }, ProviderQuotaEntry))
    }

    return { inject, apply }
  },
})
