import { LitElement, html } from '/vendor/beaker-app-stdlib/vendor/lit-element/lit-element.js'
import { repeat } from '/vendor/beaker-app-stdlib/vendor/lit-element/lit-html/directives/repeat.js'
import { ViewThreadPopup } from '/vendor/beaker-app-stdlib/js/com/popups/view-thread.js'
import { EditBookmarkPopup } from '/vendor/beaker-app-stdlib/js/com/popups/edit-bookmark.js'
import * as toast from '/vendor/beaker-app-stdlib/js/com/toast.js'
import { getAvailableName } from '/vendor/beaker-app-stdlib/js/fs.js'
import { pluralize, getOrigin, createResourceSlug } from '/vendor/beaker-app-stdlib/js/strings.js'
import { typeToQuery } from '/vendor/beaker-app-stdlib/js/records.js'
import * as QP from './lib/qp.js'
import css from '../css/main.css.js'
import '/vendor/beaker-app-stdlib/js/com/record-feed.js'
import '/vendor/beaker-app-stdlib/js/com/sites-list.js'
import '/vendor/beaker-app-stdlib/js/com/img-fallbacks.js'

const PATH_QUERIES = {
  search: [typeToQuery('bookmark'), typeToQuery('blogpost')],
  all: [typeToQuery('bookmark'), typeToQuery('blogpost')]
}

class UplinkApp extends LitElement {
  static get properties () {
    return {
      session: {type: Object},
      profile: {type: Object},
      suggestedSites: {type: Array},
      searchQuery: {type: String},
      isEmpty: {type: Boolean}
    }
  }

  static get styles () {
    return css
  }

  constructor () {
    super()
    this.session = undefined
    this.profile = undefined
    this.origins = undefined
    this.suggestedSites = undefined
    this.searchQuery = ''
    this.isEmpty = false

    this.configFromQP()
    this.load().then(() => {
      this.loadSuggestions()
    })

    window.addEventListener('popstate', (event) => {
      this.configFromQP()
    })

    window.addEventListener('focus', e => {
      if (!this.searchQuery) {
        this.load()
      }
    })
  }

  configFromQP () {
    this.searchQuery = QP.getParam('q', '')
    
    if (this.searchQuery) {
      this.updateComplete.then(() => {
        this.shadowRoot.querySelector('.search-ctrl input').value = this.searchQuery
      })
    }
  }

  async load ({clearCurrent} = {clearCurrent: false}) {
    if (!this.session) {
      this.session = await beaker.session.get()
    }
    if (!this.session) {
      return this.requestUpdate()
    }
    this.profile = this.session.user
    let {mySubscriptions} = await beaker.index.gql(`
      query Subs ($origin: String!) {
        mySubscriptions: records(paths: ["/subscriptions/*.goto"] origins: [$origin]) {
          metadata
        }
      }
    `, {origin: this.profile.url})
    var origins = new Set(mySubscriptions.map(sub => (getOrigin(sub.metadata.href))))
    origins.add(getOrigin(this.profile.url))
    this.origins = Array.from(origins)
    if (this.shadowRoot.querySelector('beaker-record-feed')) {
      this.shadowRoot.querySelector('beaker-record-feed').load({clearCurrent})
    }
  }

  async loadSuggestions () {
    if (!this.session) return
    const getSite = async (url) => {
      let {site} = await beaker.index.gql(`
        query Site ($url: String!) {
          site(url: $url) {
            url
            title
            description
            subCount: backlinkCount(paths: ["/subscriptions/*.goto"] indexes: ["local", "network"])
          }
        }
      `, {url})
      return site
    }
    let {allSubscriptions} = await beaker.index.gql(`
      query {
        allSubscriptions: records(paths: ["/subscriptions/*.goto"] limit: 100 sort: crtime reverse: true) {
          metadata
        }
      }
    `)
    var candidates = allSubscriptions.filter(sub => !this.origins.includes((getOrigin(sub.metadata.href))))
    var suggestedSiteUrls = candidates.reduce((acc, candidate) => {
      var url = candidate.metadata.href
      if (!acc.includes(url)) acc.push(url)
      return acc
    }, [])
    suggestedSiteUrls.sort(() => Math.random() - 0.5)
    var suggestedSites = await Promise.all(suggestedSiteUrls.slice(0, 12).map(url => getSite(url).catch(e => undefined)))
    suggestedSites = suggestedSites.filter(site => site && site.title)
    if (suggestedSites.length < 12) {
      let {moreSites} = await beaker.index.gql(`
        query { moreSites: sites(indexes: ["network"] limit: 12) { url } }
      `)
      moreSites = moreSites.filter(site => !this.origins.includes(site.url))

      // HACK
      // the network index for listSites() currently doesn't pull from index.json
      // (which is stupid but it's the most efficient option atm)
      // so we need to call getSite()
      // -prf
      moreSites = await Promise.all(moreSites.map(s => getSite(s.url).catch(e => undefined)))
      suggestedSites = suggestedSites.concat(moreSites).filter(Boolean)
    }
    suggestedSites.sort(() => Math.random() - 0.5)
    this.suggestedSites = suggestedSites.slice(0, 12)
  }

  get isLoading () {
    let queryViewEls = Array.from(this.shadowRoot.querySelectorAll('beaker-record-feed'))
    return !!queryViewEls.find(el => el.isLoading)
  }

  // rendering
  // =

  render () {
    return html`
      <link rel="stylesheet" href="/vendor/beaker-app-stdlib/css/fontawesome.css">
      <main>
        ${this.renderCurrentView()}
      </main>
    `
  }

  renderRightSidebar () {
    return html`
      <div class="sidebar">
        <div class="sticky">
          <div class="search-ctrl">
            ${this.isLoading ? html`<span class="spinner"></span>` : html`<span class="fas fa-search"></span>`}
            ${!!this.searchQuery ? html`
              <a class="clear-search" @click=${this.onClickClearSearch}><span class="fas fa-times"></span></a>
            ` : ''}
            <input @keyup=${this.onKeyupSearch} placeholder="Search" value=${this.searchQuery}>
          </div>
          <section class="create">
            <button class="block" @click=${e => this.onClickEditBookmark(undefined)}>
              <span class="far fa-fw fa-star"></span>
              New Bookmark
            </button>
          </section>
          ${this.suggestedSites?.length > 0 ? html`
            <section class="suggested-sites">
              <h3>Suggested Sites</h3>
              ${repeat(this.suggestedSites.slice(0, 3), site => html`
                <div class="site">
                  <div class="title">
                    <a href=${site.url} title=${site.title} target="_blank">${site.title}</a>
                  </div>
                  <div class="subscribers">
                    ${site.subCount} ${pluralize(site.subCount, 'subscriber')}
                  </div>
                  ${site.subscribed ? html`
                    <button class="transparent" disabled><span class="fas fa-check"></span> Subscribed</button>
                  ` : html`
                    <button @click=${e => this.onClickSuggestedSubscribe(e, site)}>Subscribe</button>
                  `}
                </div>
              `)}
            </section>
          ` : ''}
          <beaker-indexer-state @site-first-indexed=${e => this.load({clearCurrent: true})}></beaker-indexer-state>
        </div>
      </div>
    `
  }

  renderCurrentView () {
    if (!this.session) return this.renderIntro()
    if (!this.origins) {
      return html``
    }
    var hasSearchQuery = !!this.searchQuery
    if (hasSearchQuery) {
      return html`
        <div class="twocol">
          <div>
            <div class="brand">
              <h1>
                <a href="/" title="Beaker Uplink">
                  Beaker <span class="fas fa-arrow-up"></span>Uplink
                </a>
              </h1>
            </div>
            <beaker-record-feed
              .pathQuery=${PATH_QUERIES.search}
              .filter=${this.searchQuery}
              .sources=${this.origins}
              limit="50"
              empty-message="No results found${this.searchQuery ? ` for "${this.searchQuery}"` : ''}"
              @load-state-updated=${this.onFeedLoadStateUpdated}
              @view-thread=${this.onViewThread}
              @publish-reply=${this.onPublishReply}
              profile-url=${this.profile ? this.profile.url : ''}
            ></beaker-record-feed>
          </div>
          ${this.renderRightSidebar()}
        </div>
      `
    } else {
      return html`
        <div class="twocol">
          <div>
            <div class="brand">
              <h1>
                <a href="/" title="Beaker Uplink">
                  Beaker <span class="fas fa-arrow-up"></span>Uplink
                </a>
              </h1>
            </div>
            ${this.isEmpty && !this.isIntroActive ? this.renderEmptyMessage() : ''}
            <beaker-record-feed
              show-date-titles
              date-title-range="month"
              .pathQuery=${PATH_QUERIES.all}
              .sources=${this.origins}
              limit="50"
              @load-state-updated=${this.onFeedLoadStateUpdated}
              @view-thread=${this.onViewThread}
              @publish-reply=${this.onPublishReply}
              profile-url=${this.profile ? this.profile.url : ''}
            ></beaker-record-feed>
          </div>
          ${this.renderRightSidebar()}
        </div>
      `
    }
  }

  renderEmptyMessage () {
    if (this.searchQuery) {
      return html`
        <div class="empty">
            <div class="fas fa-search"></div>
          <div>No results found for "${this.searchQuery}"</div>
        </div>
      `
    }
    return html`
      <div class="empty">
        <div class="fas fa-stream"></div>
        <div>Subscribe to sites to see what's new</div>
      </div>
    `
  }

  renderIntro () {
    return html`
      <div class="intro">
        <div class="explainer">
          <img src="/img/uplink">
          <h3>Welcome to Beaker Uplink!</h3>
          <p>See recent bookmarks and blogposts in your network.</p>
          <p>(You know. Like Reddit.)</p>
        </div>
        <div class="sign-in">
          <button class="primary" @click=${this.onClickSignin}>Sign In</button> to get started
        </div>
      </div>
    `
  }

  // events
  // =

  onFeedLoadStateUpdated (e) {
    if (typeof e.detail?.isEmpty !== 'undefined') {
      this.isEmpty = e.detail.isEmpty
    }
    this.requestUpdate()
  }

  onKeyupSearch (e) {
    if (e.code === 'Enter') {
      this.searchQuery = e.currentTarget.value.toLowerCase()
      QP.setParams({q: this.searchQuery})
    }
  }

  onClickClearSearch (e) {
    this.searchQuery = ''
    QP.setParams({q: false})
    this.shadowRoot.querySelector('.search-ctrl input').value = ''
  }

  onViewThread (e) {
    ViewThreadPopup.create({
      recordUrl: e.detail.record.url,
      profileUrl: this.profile.url
    })
  }

  async onClickEditBookmark (file) {
    try {
      await EditBookmarkPopup.create(file)
      this.load()
    } catch (e) {
      // ignore
      console.log(e)
    }
  }

  onPublishReply (e) {
    toast.create('Reply published', '', 10e3)
    this.load()
  }

  async onClickSuggestedSubscribe (e, site) {
    e.preventDefault()
    site.subscribed = true
    this.requestUpdate()

    var drive = beaker.hyperdrive.drive(this.profile.url)
    var slug = createResourceSlug(site.url, site.title)
    var filename = await getAvailableName('/subscriptions', slug, drive, 'goto') // avoid collisions
    await drive.writeFile(`/subscriptions/${filename}`, '', {metadata: {
      href: site.url,
      title: site.title
    }})
    // wait 1s then replace/remove the suggestion
    setTimeout(() => {
      this.suggestedSites = this.suggestedSites.filter(s => s !== site)
    }, 1e3)
  }

  async onClickSignin () {
    await beaker.session.request({
      permissions: {
        publicFiles: [
          {path: '/subscriptions/*.goto', access: 'write'},
          {path: '/bookmarks/*.goto', access: 'write'},
          {path: '/comments/*.md', access: 'write'},
          {path: '/votes/*.goto', access: 'write'}
        ]
      }
    })
    location.reload()
  }
}

customElements.define('uplink-app', UplinkApp)
