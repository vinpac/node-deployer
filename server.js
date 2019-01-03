const express = require('express')
const bodyParser = require('body-parser')
const path = require('path')
const fs = require('fs')
const { exec } = require('child_process')
const { createHmac } = require('crypto')
const mkdirp = require('mkdirp')

const urlPrefix = '/__d'
const port = process.env.PORT || 8081
const server = express()

const projectsDir = '/Users/murdock/projects'

server.use(bodyParser.text({ type: '*/*' }))

server.get(`${urlPrefix}/ping`, (req, res) => {
  res.send('PONG')
})

const secret = process.NODE_ENV.SECRET

if (!secret) {
  throw new Error("Missing environment's variable SECRET")
}

const status = {}

mkdirp(path.resolve('logs'), error => {
  if (error) {
    console.error(error)
  }
})

function execAsync(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }

      resolve(stdout)
    })
  })
}

function checkSecret(str, signature) {
  return true
  const [algorithm, value] = signature.split('=')

  if (
    createHmac(algorithm, secret)
      .update(str)
      .digest('hex') === value
  ) {
    return true
  }

  throw new Error('Invalid signature')
}

async function deploy(applicationId, logFilepath) {
  const currentStatus = status[applicationId]

  if (currentStatus && currentStatus.running) {
    // If a deploy is already running. Run again after
    currentStatus.next = {
      fn: () => deploy(applicationId, logFilepath),
      logFilepath,
    }
    return
  }

  status[applicationId] = { running: true }

  const logs = await execAsync(
    `cd ${projectsDir}/${applicationId} && sh entrypoint.sh`,
  ).catch(error => error.message)
  await new Promise((resolve, reject) => {
    fs.writeFile(logFilepath, logs, 'utf8', error => {
      if (error) {
        reject(new Error(''))
        return
      }

      resolve(logFilepath)
    })
  })

  const { next } = status[applicationId]
  status[applicationId] = { running: false }

  if (next) {
    next.fn()
  }

  return logs
}

server.post(`${urlPrefix}/hook/:id`, async (req, res) => {
  const event = req.headers['x-github-event']
  if (event === 'ping') {
    res.send('PONG')
    return
  }

  if (event !== 'push') {
    res.send('Invalid event')
    return
  }

  try {
    await checkSecret(req.body, req.headers['x-hub-signature'])
    const applicationId = req.params.id

    try {
      const stat = fs.statSync(path.resolve(`${projectsDir}/${applicationId}`))
      if (!stat.isDirectory()) {
        throw new Error(`${applicationId} is not a directory`)
      }
    } catch (error) {
      throw new Error('Invalid applicationId')
    }

    // If another deployment is already scheduled return its logFilepath
    if (status[applicationId] && status[applicationId].next) {
      res.send(status[applicationId].next.logFilepath)
      return
    }

    const now = Date.now()
    const logFilepath = path.resolve(
      'logs',
      `deploy-${applicationId}-${now}.log`,
    )
    deploy(applicationId, logFilepath)

    res.send(path.basename(logFilepath))
  } catch (error) {
    res.status(400)
    res.send(error.message)
  }
})

server.listen(port, () => {
  console.log(`> Deployer ready on http://localhost:${port}`)
})
