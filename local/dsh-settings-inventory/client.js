/**
 * Browser half of the skills/MCP inventory pages: two additive Settings
 * sections (`settings.section`) presenting what the Host projects over its
 * authenticated `/dsh-inventory` channel.
 *
 * Built artifact of a profile bundle, so it is plain JavaScript in the
 * `window.__ModuleLoader__.load` format rather than a compiled module: the
 * modules node half serves this file into the boot graph from the package
 * manifest's `./client` export. Only `react` comes from the shared module table;
 * every control is written here against the host's theme tokens, so no Harness
 * Client package is loaded and no version drift can blank the page.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-settings-inventory',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Dictionary namespace owned by this bundle. */
    const NS = 'settings.inventory'
    /** Authenticated Host route, document-relative so a mount proxy works. */
    const ROUTE = 'api/dsh-inventory'
    /** The scope label the Host uses for a skill visible without any preset. */
    const GLOBAL_SCOPE = '(global)'
    /** Per-page cap on rendered chips, so one large server cannot dominate the DOM. */
    const CHIP_LIMIT = 40

    const CSS = `
.dsiSection{display:flex;flex-direction:column;gap:14px;width:100%;max-width:760px;color:var(--dsw-alias-label-primary)}
.dsiHeading{margin:0;font-size:18px;line-height:26px;font-weight:500}
.dsiIntro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.dsiSearchWrap{display:flex;align-items:center;width:100%}
.dsiSearch{width:100%;height:36px;box-sizing:border-box;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);padding:0 12px;outline:none;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.dsiSearch::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsiSearch:focus-visible{border-color:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary)) 18%,transparent)}
.dsiCount{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dsiSpinnerWrap{display:flex;justify-content:center;padding:28px 0}
.dsiSpinner{width:18px;height:18px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-secondary);border-radius:50%;animation:dsiSpin 700ms linear infinite}
@keyframes dsiSpin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.dsiSpinner{animation:none}}
.dsiNotice{display:flex;flex-wrap:wrap;align-items:center;gap:10px;border-radius:var(--dsw-radius-lg);padding:10px 12px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.dsiNotice[data-tone='error']{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}
.dsiNotice button{border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);padding:4px 10px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.dsiNotice button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsiNotice button:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dsiCards{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}
.dsiCard{min-width:0;overflow:hidden;border:0.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill);padding:12px 14px}
.dsiCardHead{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.dsiName{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code);font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsiTags{display:inline-flex;flex:none;flex-wrap:wrap;justify-content:flex-end;gap:6px}
.dsiTag{max-width:200px;overflow:hidden;text-overflow:ellipsis;border-radius:var(--dsw-radius-sm);padding:1px 7px;font-size:11px;line-height:17px;white-space:nowrap;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dsiTag[data-tone='success']{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}
.dsiTag[data-tone='idle']{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-idle-primary)}
.dsiTag[data-tone='warn']{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent);color:var(--dsw-alias-state-warn-primary)}
.dsiTag[data-tone='info']{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-brand-primary)}
.dsiDesc{margin:6px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dsiHint{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.dsiFacts{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px;margin:8px 0 0;font-size:12px;line-height:18px}
.dsiFacts dt{color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.dsiFacts dd{min-width:0;margin:0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dsiFacts dd code{font-family:var(--ds-font-family-code);font-size:12px}
.dsiChips{display:flex;flex-wrap:wrap;gap:6px}
.dsiChip{font-family:var(--ds-font-family-code);font-size:11px;line-height:17px;border-radius:var(--dsw-radius-sm);padding:1px 6px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.dsiMuted{color:var(--dsw-alias-label-tertiary)}
`

    /** Section copy for both pages, keyed by built-in locale. */
    const LOCALES = {
      zh: {
        skillsNav: '技能',
        skillsTitle: '技能',
        mcpNav: 'MCP',
        mcpTitle: 'MCP 服务器',
        mcpIntro: '本 profile 当前挂载的 MCP 服务器，以及在其他 profile 中配置的服务器。',
        mcpOtherNotice: '标记为其他 profile 的服务器已在别处配置，未在本 profile 挂载，本部署可用的工具不会因此改变',
        mcpUnreadable: 'profile {names} 无法读取，其配置未列出',
        mcpOtherProfilesUnavailable: '无法读取其他 profile 的配置：{reason}',
        searchSkills: '搜索技能',
        searchMcp: '搜索服务器',
        loadFailed: '读取失败',
        retry: '重试',
        emptySkills: '当前部署没有可见的技能',
        emptyMcp: '当前组合没有挂载 MCP 服务器',
        emptySearch: '没有匹配的条目',
        scopeGlobal: '全局',
        projectRoots: '项目技能目录：{cwd}',
        noProjectRoots: '没有已打开的项目，项目内的技能目录未被读取',
        skillsIncomplete: '部分技能提供方未能完成读取，列表可能不完整',
        presetBroken: '预设 {name} 无法挂载',
        whenToUse: '适用场景',
        scopes: '可见分组',
        userOnly: '仅用户可调用',
        modelOnly: '仅模型可调用',
        enabled: '已启用',
        disabled: '已禁用',
        conditional: '按条件启用',
        command: '启动命令',
        url: '地址',
        credentials: '凭据字段',
        credentialsNone: '无',
        timeout: '调用超时',
        failOnStartup: '启动失败即报错',
        tools: '工具',
        toolsNone: '未注册工具',
        toolsInactive: '未在本 profile 挂载',
        moreChips: '另有 {count} 个',
        fromPreset: '预设 {name}',
        fromProfile: '本 profile',
        fromOtherProfile: 'profile {name}',
        notMounted: '未挂载',
        provider: '提供方',
        path: '文件',
        entry: '配置行',
        countSkills: '共 {count} 个技能',
        countMcp: '共 {count} 个服务器',
        countShown: '显示 {shown} / {total}',
      },
      en: {
        skillsNav: 'Skills',
        skillsTitle: 'Skills',
        mcpNav: 'MCP',
        mcpTitle: 'MCP servers',
        mcpIntro: 'MCP servers this profile mounts, plus servers configured in other profiles.',
        mcpOtherNotice: 'Servers tagged with another profile are configured there but not mounted here, so the tools this deployment offers do not change',
        mcpUnreadable: 'Profile {names} could not be read, so its configuration is not listed',
        mcpOtherProfilesUnavailable: 'Could not read the other profiles: {reason}',
        searchSkills: 'Search skills',
        searchMcp: 'Search servers',
        loadFailed: 'Could not read the inventory',
        retry: 'Retry',
        emptySkills: 'This deployment has no visible skills',
        emptyMcp: 'This composition mounts no MCP server',
        emptySearch: 'No matching entry',
        scopeGlobal: 'Global',
        projectRoots: 'Project skill directories: {cwd}',
        noProjectRoots: 'No project is open, so project-local skill directories were not read',
        skillsIncomplete: 'Some skill providers did not finish, so this list may be incomplete',
        presetBroken: 'Preset {name} cannot be mounted',
        whenToUse: 'Use when',
        scopes: 'Visible in',
        userOnly: 'User only',
        modelOnly: 'Model only',
        enabled: 'Enabled',
        disabled: 'Disabled',
        conditional: 'Conditional',
        command: 'Command',
        url: 'URL',
        credentials: 'Credential fields',
        credentialsNone: 'None',
        timeout: 'Call timeout',
        failOnStartup: 'Fails on startup error',
        tools: 'Tools',
        toolsNone: 'No tool registered',
        toolsInactive: 'Not mounted in this profile',
        moreChips: '{count} more',
        fromPreset: 'Preset {name}',
        fromProfile: 'This profile',
        fromOtherProfile: 'profile {name}',
        notMounted: 'Not mounted',
        provider: 'Provider',
        path: 'File',
        entry: 'Entry',
        countSkills: '{count} skills',
        countMcp: '{count} servers',
        countShown: 'Showing {shown} of {total}',
      },
    }

    /** Insert this bundle's stylesheet once; the returned disposer removes it. */
    function installStyles() {
      const tag = document.createElement('style')
      tag.dataset.plugin = '@local/dsh-settings-inventory'
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    /** Read one page's projection from the authenticated Host route. */
    async function read(endpoint, cwd, signal) {
      const query = new URLSearchParams({ endpoint })
      if (cwd !== undefined) query.set('cwd', cwd)
      const response = await fetch(`${ROUTE}?${query.toString()}`, { signal })
      if (!response.ok) throw new Error(`${endpoint}: HTTP ${String(response.status)}`)
      return await response.json()
    }

    /** Centered bare spinner for a page-level load. */
    function Spinner() {
      return h('div', { className: 'dsiSpinnerWrap' }, h('div', { className: 'dsiSpinner' }))
    }

    /** In-place failure notice with the retry action that owns the failed query. */
    function Failure(props) {
      return h('div', { className: 'dsiNotice', 'data-tone': 'error' },
        h('span', null, props.t('loadFailed')),
        h('button', { type: 'button', onClick: props.onRetry }, props.t('retry')))
    }

    /** Read-only capsule. */
    function Tag(props) {
      return h('span', { className: 'dsiTag', 'data-tone': props.tone, title: props.title }, props.children)
    }

    /** One `<dt>/<dd>` pair, or nothing when the value is absent. */
    function Fact(props) {
      const empty = props.value === null || props.value === undefined || props.value === ''
      if (empty) return null
      return h(React.Fragment, null, h('dt', null, props.label), h('dd', null, props.value))
    }

    /** Search box over an already-loaded page. */
    function Search(props) {
      return h('div', { className: 'dsiSearchWrap' },
        h('input', {
          className: 'dsiSearch',
          type: 'search',
          value: props.value,
          placeholder: props.placeholder,
          'aria-label': props.placeholder,
          onChange: event => props.onChange(event.currentTarget.value),
        }))
    }

    /** Chip row capped at a readable length. */
    function Chips(props) {
      if (props.values.length === 0) return null
      const shown = props.values.slice(0, CHIP_LIMIT)
      const rest = props.values.length - shown.length
      const chips = shown.map(value => h('span', { className: 'dsiChip', key: value }, value))
      if (rest > 0) {
        chips.push(h('span', { className: 'dsiChip dsiMuted', key: '__rest' },
          props.moreLabel(rest)))
      }
      return h('div', { className: 'dsiChips' }, chips)
    }

    /**
     * Run one inventory query for the active page, re-running when the project
     * directory arrives or the reader asks for a retry.
     */
    function useInventory(load, cwd) {
      const [attempt, setAttempt] = React.useState(0)
      const [state, setState] = React.useState({ status: 'loading' })
      React.useEffect(() => {
        let current = true
        setState({ status: 'loading' })
        void Promise.resolve()
          .then(() => load(cwd))
          .then(
            value => { if (current) setState({ status: 'ready', value }) },
            () => { if (current) setState({ status: 'error' }) },
          )
        return () => { current = false }
      }, [load, cwd, attempt])
      return { state, retry: () => { setAttempt(value => value + 1) } }
    }

    /** The project directory the skills page reads project-local roots from. */
    function useProjectCwd(useWorkspaces) {
      return useWorkspaces((snapshot) => {
        const items = snapshot.items
        return items.length === 0 ? undefined : items[0].path
      })
    }

    /** Render the shared body of both pages: heading, intro, search, count, notices, cards. */
    function PageFrame(props) {
      const body = []
      body.push(h('h2', { className: 'dsiHeading', key: 'title' }, props.title))
      body.push(h('p', { className: 'dsiIntro', key: 'intro' }, props.intro))
      if (props.search !== undefined) body.push(props.search)
      if (props.count !== null) body.push(h('p', { className: 'dsiCount', key: 'count' }, props.count))
      for (const notice of props.notices) body.push(notice)
      if (props.empty !== null) body.push(h('p', { className: 'dsiIntro', key: 'empty' }, props.empty))
      if (props.cards !== null) body.push(props.cards)
      return h('div', { className: 'dsiSection' }, body)
    }

    /** Filter a row set by the free-text query across its searchable fields. */
    function matching(rows, query, fields) {
      const normalized = query.trim().toLocaleLowerCase()
      if (normalized === '') return rows
      return rows.filter(row => fields(row).some(value =>
        typeof value === 'string' && value.toLocaleLowerCase().includes(normalized)))
    }

    /** Skills settings page: the merged catalog with per-skill group membership. */
    function SkillsPage(props) {
      const { t, load, useWorkspaces } = props
      const cwd = useProjectCwd(useWorkspaces)
      const { state, retry } = useInventory(load, cwd)
      const [query, setQuery] = React.useState('')

      if (state.status === 'loading') return h(Spinner)
      if (state.status === 'error') return h(Failure, { t, onRetry: retry })

      const data = state.value
      if (data.available === false) {
        return h(PageFrame, {
          title: t('skillsTitle'), intro: data.reason, search: undefined,
          count: null, notices: [], empty: null, cards: null,
        })
      }

      const rows = matching(data.entries, query, entry => [
        entry.name, entry.description, entry.whenToUse, entry.source, entry.provider,
      ])
      const searching = query.trim() !== ''
      const notices = []
      if (data.complete === false) notices.push(h('div', { className: 'dsiNotice', key: 'incomplete' }, t('skillsIncomplete')))
      for (const scope of data.scopes) {
        if (scope.broken === null) continue
        notices.push(h('div', { className: 'dsiNotice', key: 'broken-' + scope.id },
          t('presetBroken', { name: scope.name === null ? scope.id : scope.name })))
      }
      const empty = data.entries.length === 0
        ? t('emptySkills')
        : rows.length === 0 && searching ? t('emptySearch') : null

      return h(PageFrame, {
        title: t('skillsTitle'),
        intro: cwd === undefined ? t('noProjectRoots') : t('projectRoots', { cwd }),
        search: h(Search, { value: query, placeholder: t('searchSkills'), onChange: setQuery }),
        count: searching
          ? t('countShown', { shown: String(rows.length), total: String(data.entries.length) })
          : t('countSkills', { count: String(data.entries.length) }),
        notices,
        empty,
        cards: rows.length === 0 ? null : h('ul', { className: 'dsiCards' }, rows.map(skillCard)),
      })

      function skillCard(entry) {
        const tags = [h(Tag, { tone: 'info', key: 'source', title: entry.source }, entry.source)]
        if (!entry.modelInvocable) tags.push(h(Tag, { tone: 'warn', key: 'userOnly' }, t('userOnly')))
        if (!entry.userInvocable) tags.push(h(Tag, { tone: 'warn', key: 'modelOnly' }, t('modelOnly')))
        const scopeChips = h('span', { className: 'dsiChips' }, entry.scopeIds.map(scopeId =>
          h('span', { className: 'dsiChip', key: scopeId },
            scopeId === GLOBAL_SCOPE ? t('scopeGlobal') : scopeId)))
        const facts = [
          h(Fact, { key: 'scopes', label: t('scopes'), value: scopeChips }),
          h(Fact, { key: 'provider', label: t('provider'), value: entry.provider }),
          h(Fact, {
            key: 'path', label: t('path'),
            value: entry.path === null ? null : h('code', null, entry.path),
          }),
        ]
        const children = [
          h('div', { className: 'dsiCardHead', key: 'head' },
            h('code', { className: 'dsiName', title: entry.name }, entry.name),
            h('span', { className: 'dsiTags' }, tags)),
          h('p', { className: 'dsiDesc', key: 'desc' }, entry.description),
        ]
        if (entry.whenToUse !== null) {
          children.push(h('p', { className: 'dsiHint', key: 'when' },
            t('whenToUse') + ': ' + entry.whenToUse))
        }
        children.push(h('dl', { className: 'dsiFacts', key: 'facts' }, facts))
        return h('li', { className: 'dsiCard', key: entry.name }, children)
      }
    }

    /** MCP settings page: one card per server, mounted rows first. */
    function McpPage(props) {
      const { t, load } = props
      const { state, retry } = useInventory(load, undefined)
      const [query, setQuery] = React.useState('')

      if (state.status === 'loading') return h(Spinner)
      if (state.status === 'error') return h(Failure, { t, onRetry: retry })

      const data = state.value
      const rows = matching(data.servers, query, server => [
        server.serverName, server.transport, server.command, server.url, server.originLabel,
      ])
      const searching = query.trim() !== ''
      const empty = data.servers.length === 0
        ? t('emptyMcp')
        : rows.length === 0 && searching ? t('emptySearch') : null

      const notices = []
      // The distinction the page draws is only worth drawing if it is stated:
      // a reader who skims the cards must still learn that the tagged rows are
      // configured elsewhere and add nothing to this deployment's tools.
      if (data.servers.some(server => server.origin === 'other-profile')) {
        notices.push(h('div', { className: 'dsiNotice', key: 'other' }, t('mcpOtherNotice')))
      }
      const unreadable = data.unreadableProfiles ?? []
      if (unreadable.length > 0) {
        notices.push(h('div', { className: 'dsiNotice', key: 'unreadable' },
          t('mcpUnreadable', { names: unreadable.map(entry => entry.name).join(', ') })))
      }
      // The other-profile read can fail as a whole, and the page must say so:
      // an empty list is otherwise indistinguishable from "no server is
      // configured anywhere", which is the confusion this page exists to end.
      if (data.otherProfilesUnavailable !== null && data.otherProfilesUnavailable !== undefined) {
        notices.push(h('div', { className: 'dsiNotice', 'data-tone': 'error', key: 'otherProfiles' },
          t('mcpOtherProfilesUnavailable', { reason: data.otherProfilesUnavailable })))
      }

      return h(PageFrame, {
        title: t('mcpTitle'),
        intro: t('mcpIntro'),
        search: h(Search, { value: query, placeholder: t('searchMcp'), onChange: setQuery }),
        count: searching
          ? t('countShown', { shown: String(rows.length), total: String(data.servers.length) })
          : t('countMcp', { count: String(data.servers.length) }),
        notices,
        empty,
        cards: rows.length === 0 ? null : h('ul', { className: 'dsiCards' }, rows.map(serverCard)),
      })

      function serverCard(server, index) {
        const mounted = server.origin === 'profile' || server.origin === 'preset'
        const stateLabel = !mounted
          ? t('notMounted')
          : server.conditional !== ''
            ? t('conditional')
            : server.enabled ? t('enabled') : t('disabled')
        const tags = [
          h(Tag, {
            key: 'state',
            // An unmounted row is idle, never success: it must not read as
            // "enabled here", which is the whole distinction this page draws.
            tone: !mounted ? 'idle' : server.enabled ? 'success' : 'idle',
            title: server.conditional === '' ? undefined : server.conditional,
          }, stateLabel),
        ]
        if (server.transport !== '') tags.push(h(Tag, { tone: 'info', key: 'transport' }, server.transport))
        tags.push(h(Tag, { tone: 'info', key: 'origin' }, server.origin === 'preset'
          ? t('fromPreset', { name: server.originLabel === null ? server.entryId : server.originLabel })
          : server.origin === 'other-profile'
            ? t('fromOtherProfile', { name: server.originLabel })
            : t('fromProfile')))

        const credentialValues = server.envNames.concat(
          server.headerNames.map(name => name + ' (header)'))
        // An empty string means "this transport has no such field"; the Fact
        // component already drops those, so pass the value straight through.
        const facts = [
          h(Fact, { key: 'entry', label: t('entry'), value: h('code', null, server.entryId ?? '—') }),
          h(Fact, { key: 'command', label: t('command'), value: server.command }),
          h(Fact, { key: 'url', label: t('url'), value: server.url }),
          h(Fact, {
            key: 'credentials',
            label: t('credentials'),
            value: credentialValues.length === 0 ? t('credentialsNone') : h(Chips, {
              values: credentialValues,
              moreLabel: rest => t('moreChips', { count: String(rest) }),
            }),
          }),
          h(Fact, {
            key: 'timeout', label: t('timeout'),
            value: server.toolCallTimeoutMs === null ? null : String(server.toolCallTimeoutMs) + ' ms',
          }),
          h(Fact, {
            key: 'failOnStartup', label: t('failOnStartup'),
            value: server.failOnStartupError ? t('enabled') : null,
          }),
          h(Fact, {
            key: 'tools',
            label: t('tools'),
            // An unmounted server has no tool here by construction, so "none
            // registered" would be a misleading reason for the empty list.
            value: !mounted
              ? t('toolsInactive')
              : server.tools.length === 0 ? t('toolsNone') : h(Chips, {
                values: server.tools,
                moreLabel: rest => t('moreChips', { count: String(rest) }),
              }),
          }),
        ]
        const children = [
          h('div', { className: 'dsiCardHead', key: 'head' },
            h('code', { className: 'dsiName', title: server.serverName }, server.serverName),
            h('span', { className: 'dsiTags' }, tags)),
        ]
        if (server.condition !== undefined && server.condition !== '') {
          children.push(h('p', { className: 'dsiHint', key: 'condition' }, h('code', null, server.condition)))
        }
        children.push(h('dl', { className: 'dsiFacts', key: 'facts' }, facts))
        return h('li', {
          className: 'dsiCard',
          key: server.origin + ':' + String(index),
        }, children)
      }
    }

    /**
     * Required services: slot registration and the dictionaries. The route is a
     * plain same-origin fetch under `/api`, which Connection has already fenced
     * and authenticated, so this half needs no service to reach it.
     */
    const inject = ['slots', 'locale']

    /** Register the stylesheet, dictionaries, and both Settings sections. */
    function apply(ctx) {
      ctx.effect(installStyles, 'dsh-settings-inventory: stylesheet')
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, 'zh', LOCALES.zh), 'dsh-settings-inventory: zh dictionary')
      ctx.effect(() => ctx.locale.register(NS, 'en', LOCALES.en), 'dsh-settings-inventory: en dictionary')

      const skillsLoad = cwd => read('skills', cwd)
      const mcpLoad = () => read('mcp')

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'skills-inventory',
        order: 16,
        label: () => t('skillsNav'),
        locale: NS,
        inject: () => ({ load: skillsLoad }),
      }, SkillsPage))

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'mcp-inventory',
        order: 17,
        label: () => t('mcpNav'),
        locale: NS,
        inject: () => ({ load: mcpLoad }),
      }, McpPage))
    }

    return { inject, apply }
  },
})
