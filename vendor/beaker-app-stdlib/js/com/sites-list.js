import { LitElement, html } from '../../vendor/lit-element/lit-element.js'
import { repeat } from '../../vendor/lit-element/lit-html/directives/repeat.js'
import { ifDefined } from '../../vendor/lit-element/lit-html/directives/if-defined.js'
import { SitesListPopup } from './popups/sites-list.js'
import css from '../../css/com/sites-list.css.js'
import { emit } from '../dom.js'
import { shorten, pluralize, isSameOrigin, toNiceDomain } from '../strings.js'
import { writeToClipboard } from '../clipboard.js'
import * as toast from './toast.js'

const EXPLORER_URL = site => `beaker://explorer/${site.url.slice('hyper://'.length)}`

export class SitesList extends LitElement {
  static get properties () {
    return {
      listing: {type: String},
      singleRow: {type: Boolean, attribute: 'single-row'},
      filter: {type: String},
      limit: {type: Number},
      profile: {type: Object},
      sites: {type: Array},
      emptyMessage: {type: String, attribute: 'empty-message'},
    }
  }

  static get styles () {
    return css
  }

  constructor () {
    super()
    this.listing = undefined
    this.singleRow = false
    this.filter = undefined
    this.limit = undefined
    this.profile = undefined
    this.sites = undefined
    this.emptyMessage = undefined

    // query state
    this.activeQuery = undefined
  }

  get profileUrl () {
    return this.profile?.url
  }

  get isLoading () {
    return !this.sites || !!this.activeQuery
  }

  async load () {
    this.queueQuery()
  }

  updated (changedProperties) {
    if (typeof this.sites === 'undefined') {
      if (!this.activeQuery) {
        this.queueQuery()
      }
    }
    if (changedProperties.has('singleRow') && changedProperties.get('singleRow') != this.singleRow) {
      this.queueQuery()
    } else if (changedProperties.has('filter') && changedProperties.get('filter') != this.filter) {
      this.queueQuery()
    } else if (changedProperties.has('listing') && changedProperties.get('listing') != this.listing) {
      this.queueQuery()
    }
  }

  getSiteIdent (site) {
    if (isSameOrigin(site.url, this.profileUrl)) {
      return 'profile'
    }
    if (isSameOrigin(site.url, 'hyper://private')) {
      return 'private'
    }
    return undefined
  }

  queueQuery () {
    if (!this.activeQuery) {
      this.activeQuery = this.query()
      this.requestUpdate()
    } else {
      this.activeQuery = this.activeQuery.catch(e => undefined).then(r => {
        this.activeQuery = undefined
        this.queueQuery()
      })
    }
  }

  async query () {
    emit(this, 'load-state-updated')

    var sites
    var isFiltered = false
    if (this.listing === 'mine') {
      sites = await beaker.drives.list({includeSystem: true})
      sites = sites.filter(s => s.info?.writable)
      sites = await Promise.all(sites.map(async s => {
        let res = await beaker.index.gql(`
          query Graph($origin: String!, $profileUrl: String!) {
            isSubscribedByUser: backlinkCount(
              origins: [$profileUrl]
              links: {origin: $origin}
              paths: ["/subscriptions/*.goto"]
            )
            isSubscriberToUser: recordCount(
              origins: [$origin]
              links: {origin: $profileUrl}
              paths: ["/subscriptions/*.goto"]
            )
            subCount: backlinkCount(
              links: {origin: $origin}
              paths: ["/subscriptions/*.goto"]
              indexes: ["local", "network"]
            )
          }
        `, {profileUrl: this.profileUrl, origin: s.url})
        return {
          origin: s.url,
          url: s.url,
          title: s.info?.title || 'Untitled',
          description: s.info?.description,
          writable: s.info?.writable,
          forkOf: s.forkOf,
          isSubscribedByUser: res.isSubscribedByUser,
          isSubscriberToUser: res.isSubscriberToUser,
          subCount: res.subCount
        }
      }))
    } else if (this.listing === 'subscribed') {
      let {subs} = await beaker.index.gql(`
        query Subscriptions($profileUrl: String!) {
          subs: records(paths: ["/subscriptions/*.goto"], origins: [$profileUrl]) {
            linkedSites {
              url
              title
              description
              writable
              isSubscribedByUser: backlinkCount(
                origins: [$profileUrl]
                paths: ["/subscriptions/*.goto"]
              )
              isSubscriberToUser: recordCount(
                links: {origin: $profileUrl}
                paths: ["/subscriptions/*.goto"]
              )
              subCount: backlinkCount(paths: ["/subscriptions/*.goto"] indexes: ["local", "network"])
            }
          }
        }
      `, {profileUrl: this.profileUrl})
      sites = subs.map(sub => sub.linkedSites[0])
    } else if (this.listing === 'subscribers') {
      let {subs} = await beaker.index.gql(`
        query Subscribers($profileUrl: String!) {
          subs: records(paths: ["/subscriptions/*.goto"], links: {origin: $profileUrl}, indexes: ["local", "network"]) {
            site (cached: true) {
              url
              title
              description
              writable
              isSubscribedByUser: backlinkCount(
                origins: [$profileUrl]
                paths: ["/subscriptions/*.goto"]
              )
              isSubscriberToUser: recordCount(
                links: {origin: $profileUrl}
                paths: ["/subscriptions/*.goto"]
              )
              subCount: backlinkCount(paths: ["/subscriptions/*.goto"] indexes: ["local", "network"])
            }
          }
        }
      `, {profileUrl: this.profileUrl})
      sites = subs.map(sub => sub.site)
    } else if (this.listing === 'network') {
      isFiltered = true
      let res = await beaker.index.gql(`
        query Sites (
          $profileUrl: String!
          ${this.filter ? `$search: String!` : ''}
        ) {
          sites (
            ${this.filter ? `search: $search"` : ''}
            indexes: ["network"]
            limit: 15
          ) {
            url
            title
            description
            writable
            isSubscribedByUser: backlinkCount(
              origins: [$profileUrl]
              paths: ["/subscriptions/*.goto"]
            )
            isSubscriberToUser: recordCount(
              links: {origin: $profileUrl}
              paths: ["/subscriptions/*.goto"]
            )
            subCount: backlinkCount(paths: ["/subscriptions/*.goto"] indexes: ["local", "network"])
          }
        }
      `, {profileUrl: this.profileUrl, search: this.filter})
      sites = res.sites
    } else {
      isFiltered = true
      let res = await beaker.index.gql(`
        query Sites(
          $profileUrl: String!
          ${this.filter ? `$search: String!` : ''}
        ) {
          sites (
            ${this.filter ? `search: $search` : ''}
            indexes: ["local", "network"]
          ) {
            url
            title
            description
            writable
            isSubscribedByUser: backlinkCount(
              origins: [$profileUrl]
              paths: ["/subscriptions/*.goto"]
            )
            isSubscriberToUser: recordCount(
              links: {origin: $profileUrl}
              paths: ["/subscriptions/*.goto"]
            )
            subCount: backlinkCount(paths: ["/subscriptions/*.goto"] indexes: ["local", "network"])
          }
        }
      `, {profileUrl: this.profileUrl, search: this.filter})
      sites = res.sites
    }

    if (this.filter && !isFiltered) {
      sites = sites.filter(s => (
        (s.title || '').toLowerCase().includes(this.filter.toLowerCase())
        || (s.description || '').toLowerCase().includes(this.filter.toLowerCase())
      ))
    }
    if (this.singleRow) {
      sites = sites.slice(0, 3)
    } else if (this.limit) {
      sites = sites.slice(0, this.limit)
    }

    if (!isFiltered) {
      sites.sort((a, b) => a.title.localeCompare(b.title))
    }

    // always put the profile and private site on top
    moveToTopIfExists(sites, this.profile?.url)
    moveToTopIfExists(sites, 'hyper://private/')
    this.sites = sites
    console.log(this.sites)
    this.activeQuery = undefined
    emit(this, 'load-state-updated')
  }

  isSubscribed (site) {
    return site.isSubscribedByUser
  }

  // rendering
  // =

  render () {
    if (!this.sites) {
      return html`
        <div class="sites empty">
          <span class="spinner"></span>
        </div>
      `
    }
    if (!this.sites.length) {
      if (!this.emptyMessage) return html``
      return html`
        <link rel="stylesheet" href=${(new URL('../../css/fontawesome.css', import.meta.url)).toString()}>
        <div class="sites empty">
          <span>${this.emptyMessage}</div></span>
        </div>
      `
    }
    return html`
      <link rel="stylesheet" href=${(new URL('../../css/fontawesome.css', import.meta.url)).toString()}>
      <div class="container">
        <div class="sites ${this.singleRow ? 'single-row' : 'full'}">
          ${repeat(this.sites, site => site.url, site => this.renderSite(site))}
        </div>
      </div>
    `
  }

  renderSite (site) {
    var title = site.title || toNiceDomain(site.url)
    return html`
      <div class="site">
        <div class="thumb">
          <a href=${site.url} title=${title}><img src="${site.url}/thumb"></a>
        </div>
        <div class="info">
          <div class="title"><a href=${site.url} title=${title}>${title}</a></div>
          <div class="description">${shorten(site.description, 200)}</div>
          ${site.forkOf ? html`
            <div class="fork-of">
              <span class="label">${site.forkOf.label}</span>
              Fork of <a href="hyper://${site.forkOf.key}">${toNiceDomain(`hyper://${site.forkOf.key}`)}</a>
            </div>
          ` : ''}
          ${!isSameOrigin(site.url, 'hyper://private') && (!site.writable || site.subCount > 0) ? html`
            <div class="known-subscribers">
              <a
                href="#" 
                class="tooltip-top"
                @click=${e => this.onClickShowSubscribers(e, site)}
              >
                <strong>${site.subCount}</strong>
                ${pluralize(site.subCount, 'subscriber')}
              </a>
            </div>
          ` : ''}
          <div class="ctrls">
            ${site.writable ? html`
              ${isSameOrigin(site.url, 'hyper://private') ? html`
                <span class="label">My Private Site</span></div>
              ` : isSameOrigin(site.url, this.profileUrl || '') ? html`
                <span class="label">My Profile Site</span></div>
              ` : html`
                <span class="label">My Site</span>
              `}
              <button class="transparent" @click=${e => this.onClickMenu(e, site)}>
                <span class="fas fa-fw fa-ellipsis-h"></span>
              </button>
            ` : html`
              <button @click=${e => this.onToggleSubscribe(e, site)}>
                ${this.isSubscribed(site) ? html`
                  <span class="fas fa-fw fa-check"></span> Subscribed
                ` : html`
                  <span class="fas fa-fw fa-rss"></span> Subscribe
                `}
              </button>
            `}
          </div>
        </div>
      </div>
    `
  }

  // events
  // =

  async onClickShowSubscribers (e, site) {
    e.preventDefault()
    e.stopPropagation()
    let sites = /* dont await */ beaker.subscriptions.listNetworkFor(site.url).then(subs => subs.map(s => s.site))
    SitesListPopup.create('Subscribers', sites)
  }

  async onToggleSubscribe (e, site) {
    if (this.isSubscribed(site)) {
      site.isSubscribedByUser = false
      site.subCount--
      this.requestUpdate()
      await beaker.subscriptions.remove(site.url)
    } else {
      site.isSubscribedByUser = true
      site.subCount++
      this.requestUpdate()
      await beaker.subscriptions.add({
        href: site.url,
        title: site.title,
        site: this.profileUrl
      })
    }
  }

  async onClickMenu (e, site) {
    var items = [
      {
        label: 'Open in a New Tab',
        click: () => window.open(site.url)
      },
      {
        label: 'Copy Site Link',
        click: () => {
          writeToClipboard(site.url)
          toast.create('Copied to clipboard')
        }
      },
      {type: 'separator'},
      {
        label: 'Explore Files',
        click: () => window.open(EXPLORER_URL(site))
      },
      {
        label: 'Fork this Site',
        click: () => this.onForkSite(site)
      },
      {type: 'separator'},
      {
        label: 'Edit Properties',
        click: () => this.onEditProps(site)
      },
      {
        label: site.writable ? 'Remove from My Library' : 'Stop hosting',
        disabled: !!this.getSiteIdent(site),
        click: () => this.onRemoveSite(site)
      }
    ]
    var fns = {}
    for (let i = 0; i < items.length; i++) {
      if (items[i].id) continue
      let id = `item=${i}`
      items[i].id = id
      fns[id] = items[i].click
      delete items[i].click
    }

    var choice = await beaker.browser.showContextMenu(items)
    if (fns[choice]) fns[choice]()
  }

  async onForkSite (site) {
    site = await beaker.hyperdrive.forkDrive(site.url)
    toast.create('Site created')
    window.open(site.url)
    this.load()
  }

  async onEditProps (site) {
    await beaker.shell.drivePropertiesDialog(site.url)
    this.load()
  }

  async onRemoveSite (site) {
    await beaker.drives.remove(site.url)
    const undo = async () => {
      await beaker.drives.configure(site.url)
      this.load()
      this.requestUpdate()
    }
    toast.create('Site removed', '', 10e3, {label: 'Undo', click: undo})
    this.load()
  }
}

customElements.define('beaker-sites-list', SitesList)

function moveToTopIfExists (arr, url) {
  var i = arr.findIndex(v => v.url === url)
  if (i !== -1) {
    let item = arr[i]
    arr.splice(i, 1)
    arr.unshift(item)
  }
}