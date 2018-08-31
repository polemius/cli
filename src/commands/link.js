const Command = require('../base')
const { flags } = require('@oclif/command')
const renderShortDesc = require('../utils/renderShortDescription')
const inquirer = require('inquirer')
const path = require('path')
const getRepoData = require('../utils/getRepoData')
const isEmpty = require('lodash.isempty')

class LinkCommand extends Command {
  async run() {
    await this.authenticate()
    const { flags } = this.parse(LinkCommand)
    const siteId = this.site.get('siteId')

    if (siteId && !flags.force) {
      let siteInaccessible = false
      let site
      try {
        site = await this.netlify.getSite({ siteId })
      } catch (e) {
        if (!e.ok) siteInaccessible = true
      }
      if (!siteInaccessible) {
        this.log(`Site already linked to ${site.name}`)
        this.log(`Link: ${site.admin_url}`)
        this.log()
        this.log(`To unlink this site, run: \`netlify unlink\``)
        return this.exit()
      }
    }

    if (flags.id) {
      let site
      try {
        site = await this.netlify.getSite({ site_id: flags.id })
      } catch (e) {
        if (e.status === 404) {
          this.error(new Error(`Site id ${flags.id} not found`))
        }
        else this.error(e)
      }
      this.site.set('siteId', site.id)
      this.log(`Linked to ${site.name} in ${path.relative(path.join(process.cwd(), '..'), this.site.path)}`)
      return this.exit()
    }

    if (flags.name) {
      let results
      try {
        results = await this.netlify.listSites({
          name: flags.name,
          filter: 'all'
        })
      } catch (e) {
        if (e.status === 404) this.error(new Error(`${flags.name} not found`))
        else this.error(e)
      }

      if (results.length === 0) {
        this.error(new Error(`No sites found named ${flags.name}`))
      }
      const site = results[0]
      this.site.set('siteId', site.id)
      this.log(`Linked to ${site.name} in ${path.relative(path.join(process.cwd(), '..'), this.site.path)}`)
      return this.exit()
    }

    const REMOTE_PROMPT = 'Use current git remote URL'
    const SITE_NAME_PROMPT = 'Site Name'
    const SITE_ID_PROMPT = 'Site ID'

    // Get remote data if exists
    const repoInfo = await getRepoData()

    const LinkChoices = [
      SITE_NAME_PROMPT,
      SITE_ID_PROMPT
    ]

    if (!repoInfo.error) {
      // Add git REMOTE_PROMPT if in a repo. TODO refactor to non mutating
      LinkChoices.splice(0, 0, REMOTE_PROMPT)
    }

    const { linkType } = await inquirer.prompt([
      {
        type: 'list',
        name: 'linkType',
        message: 'How do you want to link this folder to a site?',
        choices: LinkChoices
      }
    ])

    switch (linkType) {
      case REMOTE_PROMPT: {
        let site
        const sites = await this.netlify.listSites()

        if (repoInfo.error) {
          this.error(new Error(repoInfo.error))
        }

        if (isEmpty(repoInfo)) {
          this.error(new Error(`No git remote found in this directory`))
        }

        // TODO improve this url construction
        const repoUrl = `https://${repoInfo.provider}.com/${repoInfo.remoteData.repo}`

        if (isEmpty(sites)) {
          this.error(new Error(`No sites found in your netlify account`))
        }

        const matchingSites = sites.filter((site) => {
          return repoUrl === site.build_settings.repo_url
        })

        // If no remote matches. Throw error
        if (isEmpty(matchingSites)) {
          this.error(new Error(`No site found with the remote ${repoInfo.repo_path}.`))
        }

        // Matches a single site hooray!
        if (matchingSites.length === 1) {
          site = matchingSites[0]
        } else if (matchingSites.length > 1) {
          // Matches multiple sites. Users much choose which to link.
          console.log(`${matchingSites.length} matching sites! Please choose one:`)

          const siteChoices = matchingSites.map((site) => {
            return `${site.ssl_url} - ${site.name} - ${site.id}`
          })

          // Prompt which options
          const { siteToConnect } = await inquirer.prompt([
            {
              type: 'list',
              name: 'siteToConnect',
              message: 'Which site do you want to link to?',
              choices: siteChoices
            }
          ])

          const siteName = siteToConnect.split(' ')[0]
          site = matchingSites.filter((site) => {
            // TODO does every site have ssl_url?
            return siteName === site.ssl_url
          })[0]
        }

        linkSite(site, this)
        break
      }
      case SITE_NAME_PROMPT: {
        const { siteName } = await inquirer.prompt([
          {
            type: 'input',
            name: 'siteName',
            message: 'What is the name of the site?'
          }
        ])
        let sites
        try {
          sites = await this.netlify.listSites({
            name: siteName,
            filter: 'all'
          })
        } catch (e) {
          if (e.status === 404) this.error(`${siteName} not found`)
          else this.error(e)
        }

        if (sites.length === 0) {
          this.error(`No sites found named ${siteName}`)
        }
        let site
        if (sites.length > 1) {
          const { selectedSite } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedSite',
              paginated: true,
              choices: sites.map(site => ({ name: site.name, value: site }))
            }
          ])
          if (!selectedSite) this.error('No site selected')
          site = selectedSite
        } else {
          site = sites[0]
        }
        linkSite(site, this)
        break
      }
      case SITE_ID_PROMPT: {
        const { siteId } = await inquirer.prompt([
          {
            type: 'input',
            name: 'siteId',
            message: 'What is the site-id of the site?'
          }
        ])

        let site
        try {
          site = await this.netlify.getSite({ siteId })
        } catch (e) {
          if (e.status === 404) this.error(new Error(`Site id ${siteId} not found`))
          else this.error(e)
        }
        linkSite(site, this)
        break
      }
    }
  }
}

function linkSite(site, context) {
  if (!site) {
    context.error(new Error(`No site found`))
  }
  context.site.set('siteId', site.id)
  context.log(`Linked to ${site.name} in ${path.relative(path.join(process.cwd(), '..'), context.site.path)}`)
  context.log()
  context.log(`You can now run other \`netlify\` commands in this directory`)
  context.exit()
}

LinkCommand.description = `${renderShortDesc('Link a local repo or project folder to an existing site on Netlify')}`

LinkCommand.examples = [
  '$ netlify init --id 123-123-123-123',
  '$ netlify init --name my-site-name'
]

LinkCommand.flags = {
  id: flags.string({
    description: 'ID of site to link to'
  }),
  name: flags.string({
    description: 'Name of site to link to'
  }),
  force: flags.boolean({
    description: 'Force link a folder to a site, even if the folder is already linked'
  })
}

module.exports = LinkCommand
