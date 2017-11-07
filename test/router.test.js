require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const {startTestServer} = require('@atom/teletype-server')
const condition = require('./helpers/condition')
const {buildPeerPool, clearPeerPools} = require('./helpers/peer-pools')
const buildStarNetwork = require('./helpers/build-star-network')
const Router = require('../lib/router')

suite('Router', () => {
  let server

  suiteSetup(async () => {
    server = await startTestServer()
  })

  suiteTeardown(() => {
    return server.stop()
  })

  setup(() => {
    return server.reset()
  })

  teardown(() => {
    clearPeerPools()
  })

  test('notifications', async () => {
    const hub = buildStarNetwork('some-network-id', await buildPeerPool('hub', server), {isHub: true})
    const spoke1 = buildStarNetwork('some-network-id', await buildPeerPool('spoke-1', server), {isHub: false})
    const spoke2 = buildStarNetwork('some-network-id', await buildPeerPool('spoke-2', server), {isHub: false})
    await spoke1.connectTo('hub')
    await spoke2.connectTo('hub')

    const hubRouter = new Router(hub)
    const spoke1Router = new Router(spoke1)
    const spoke2Router = new Router(spoke2)
    recordNotifications(hubRouter, ['channel-1'])
    recordNotifications(spoke1Router, ['channel-1', 'channel-2'])
    recordNotifications(spoke2Router, ['channel-1', 'channel-2'])

    hubRouter.notify('channel-2', 'from-hub')
    spoke1Router.notify('channel-1', 'from-spoke-1')
    spoke2Router.notify('channel-2', 'from-spoke-2')

    await condition(() => deepEqual(hubRouter.testInbox, {
      'channel-1': [{senderId: 'spoke-1', message: 'from-spoke-1'}]
    }))
    await condition(() => deepEqual(spoke1Router.testInbox, {
      'channel-2': [
        {senderId: 'hub', message: 'from-hub'},
        {senderId: 'spoke-2', message: 'from-spoke-2'}
      ]
    }))
    await condition(() => deepEqual(spoke2Router.testInbox, {
      'channel-1': [{senderId: 'spoke-1', message: 'from-spoke-1'}],
      'channel-2': [{senderId: 'hub', message: 'from-hub'}]
    }))
  })

  test('request/response', async () => {
    const hub = buildStarNetwork('some-network-id', await buildPeerPool('hub', server), {isHub: true})
    const spoke1 = buildStarNetwork('some-network-id', await buildPeerPool('spoke-1', server), {isHub: false})
    const spoke2 = buildStarNetwork('some-network-id', await buildPeerPool('spoke-2', server), {isHub: false})
    await spoke1.connectTo('hub')
    await spoke2.connectTo('hub')

    const spoke1Router = new Router(spoke1)
    const spoke2Router = new Router(spoke2)

    spoke2Router.onRequest('channel-1', ({senderId, requestId, request}) => {
      assert.equal(request.toString(), 'request from spoke 1 on channel 1')
      spoke2Router.respond(requestId, {body: 'response from spoke 2 on channel 1'})
    })
    spoke2Router.onRequest('channel-2', ({senderId, requestId, request}) => {
      assert.equal(request.toString(), 'request from spoke 1 on channel 2')
      spoke2Router.respond(requestId, {body: 'response from spoke 2 on channel 2'})
    })

    {
      const response = await spoke1Router.request('spoke-2', 'channel-1', 'request from spoke 1 on channel 1')
      assert(response.ok)
      assert.equal(response.body.toString(), 'response from spoke 2 on channel 1')
    }

    {
      const response = await spoke1Router.request('spoke-2', 'channel-2', 'request from spoke 1 on channel 2')
      assert(response.ok)
      assert.equal(response.body.toString(), 'response from spoke 2 on channel 2')
    }

    // Ensure requests to nonexistent routes receive a failure response.
    {
      const response = await spoke1Router.request('spoke-2', 'nonexistent', 'request from spoke 1 on nonexistent channel')
      assert(!response.ok)
      assert.equal(response.body.length, 0)
    }

    // Ensure requests and responses with no body are allowed
    {
      spoke2Router.onRequest('channel-3', ({senderId, requestId, request}) => {
        assert.equal(request.length, 0)
        spoke2Router.respond(requestId)
      })
      const response = await spoke1Router.request('spoke-2', 'channel-3')
      assert(response.ok)
      assert.equal(response.body.length, 0)
    }

    // Ensure that multiple responses are disallowed
    {
      spoke2Router.onRequest('channel-4', ({senderId, requestId, request}) => {
        spoke2Router.respond(requestId, {body: 'response from spoke 2 on channel 4'})
        assert.throws(
          () => spoke2Router.respond(requestId, {body: 'duplicate response'}),
          'Multiple responses to the same request are not allowed'
        )
      })

      await spoke1Router.request('spoke-2', 'channel-4', 'request from spoke 1 on channel 3')
    }
  })

  test('async notification and request handlers', async () => {
    const hub = buildStarNetwork('some-network-id', await buildPeerPool('hub', server), {isHub: true})
    const spoke = buildStarNetwork('some-network-id', await buildPeerPool('spoke', server), {isHub: false})
    await spoke.connectTo('hub')

    const hubRouter = new Router(hub)
    const spokeRouter = new Router(spoke)
    const spokeInbox = []

    spokeRouter.onNotification('notification-channel-1', async ({message}) => {
      await timeout(Math.random() * 50)
      spokeInbox.push(message.toString())
    })
    spokeRouter.onNotification('notification-channel-2', async ({message}) => {
      await timeout(Math.random() * 50)
      spokeInbox.push(message.toString())
    })
    spokeRouter.onRequest('request-channel-1', async ({request}) => {
      await timeout(Math.random() * 50)
      spokeInbox.push(request.toString())
    })
    spokeRouter.onRequest('request-channel-2', async ({request}) => {
      await timeout(Math.random() * 50)
      spokeInbox.push(request.toString())
    })

    hubRouter.notify('notification-channel-1', '1')
    hubRouter.notify('notification-channel-2', '2')
    hubRouter.request('spoke', 'request-channel-1', '3')
    hubRouter.request('spoke', 'request-channel-2', '4')

    await condition(() => deepEqual(spokeInbox, ['1', '2', '3', '4']))
  })
})

function recordNotifications (router, channelIds) {
  if (!router.testInbox) router.testInbox = {}
  channelIds.forEach((channelId) => {
    router.onNotification(channelId, ({senderId, message}) => {
      if (!router.testInbox[channelId]) router.testInbox[channelId] = []
      router.testInbox[channelId].push({
        senderId, message: message.toString()
      })
      router.testInbox[channelId].sort((a, b) => a.senderId.localeCompare(b.senderId))
    })
  })
}

function timeout (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
