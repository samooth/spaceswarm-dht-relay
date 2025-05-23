#!/usr/bin/env node

const http = require('http')
const https = require('https')
const fs = require('fs')
const DHT = require('spacedht')
const { WebSocketServer } = require('ws')
const { relay } = require('spaceswarm-dht-relay')
const Stream = require('spaceswarm-dht-relay/ws')
const goodbye = require('graceful-goodbye')

const behindProxy = argv('behind-proxy', Boolean)
const port = argv('port', Number, 49443)
const host = argv('host', String)
const ssl = {
  cert: argv('cert', String),
  key: argv('key', String)
}

if ((ssl.cert && !ssl.key) || (!ssl.cert && ssl.key)) throw new Error('Requires both --cert and --key')

const node = new DHT()

if (ssl.cert) ssl.cert = fs.readFileSync(ssl.cert) // eg fullchain.pem
if (ssl.key) ssl.key = fs.readFileSync(ssl.key) // eg privkey.pem

const isSecure = ssl.cert && ssl.key
const server = (isSecure ? https : http).createServer({ ...ssl })
const wss = new WebSocketServer({ server })
const connections = new Set()

wss.on('connection', function (socket, req) {
  const remoteInfo = getRemoteAddress(req) + ':' + req.socket.remotePort

  connections.add(socket)
  console.log('Connection opened (' + connections.size + ')', remoteInfo)

  socket.on('close', function () {
    connections.delete(socket)
    console.log('Connection closed (' + connections.size + ')', remoteInfo)
  })

  relay(node, new Stream(false, socket))
})

server.listen(port, host, function () {
  const addr = server.address()
  console.log('Relay is listening at host', addr.address + ' (' + addr.family + ')', 'on port', addr.port)
})

goodbye(async function () {
  const termination = []
  const closing = waitForClose(server)

  server.close()

  for (const socket of connections) {
    termination.push(waitForClose(socket))
    socket.terminate()
  }

  await Promise.all(termination)
  await closing
  await node.destroy()
})

function getRemoteAddress (req) {
  if (behindProxy) return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return req.socket.remoteAddress
}

function waitForClose (emitter) {
  return new Promise(resolve => emitter.once('close', resolve))
}

function argv (name, type, defaultValue = null) {
  const i = process.argv.indexOf('--' + name)
  if (type === Boolean) return i > -1
  if (i === -1) return defaultValue

  const hasValue = i < process.argv.length - 1
  if (!hasValue) return defaultValue

  let value = process.argv[i + 1]

  if (type === Number) {
    value = parseInt(value, 10)
    if (Number.isNaN(value)) throw new Error('Invalid CLI value for argument --' + name)
    return value
  }

  if (type === String) return value

  throw new Error('Invalid CLI type for argument --' + name)
}
