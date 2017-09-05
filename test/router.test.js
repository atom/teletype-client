require('./setup')
const assert = require('assert')
const deepEqual = require('deep-equal')
const {startTestServer} = require('@atom/real-time-server')
const condition = require('./helpers/condition')
const {buildPeerPool, clearPeerPools} = require('./helpers/peer-pools')
const buildStarNetwork = require('./helpers/build-star-network')
const getExampleMediaStream = require('./helpers/get-example-media-stream')
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
    server.identityProvider.setUsersByOauthToken({
      'some-token': {username: 'some-user'},
    })

    return server.reset()
  })

  teardown(() => {
    clearPeerPools()
  })

  test('notifications', async () => {
    const hub = buildStarNetwork('some-network-id', await buildPeerPool('hub', 'some-token', server), true)
    const spoke1 = buildStarNetwork('some-network-id', await buildPeerPool('spoke-1', 'some-token', server), false)
    const spoke2 = buildStarNetwork('some-network-id', await buildPeerPool('spoke-2', 'some-token', server), false)
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
    const hub = buildStarNetwork('some-network-id', await buildPeerPool('hub', 'some-token', server), true)
    const spoke1 = buildStarNetwork('some-network-id', await buildPeerPool('spoke-1', 'some-token', server), false)
    const spoke2 = buildStarNetwork('some-network-id', await buildPeerPool('spoke-2', 'some-token', server), false)
    await spoke1.connectTo('hub')
    await spoke2.connectTo('hub')

    const spoke1Router = new Router(spoke1)
    const spoke2Router = new Router(spoke2)

    spoke2Router.onRequest('channel-1', ({senderId, requestId, request}) => {
      assert.equal(request.toString(), 'request from spoke 1 on channel 1')
      spoke2Router.respond(requestId, 'response from spoke 2 on channel 1')
    })
    spoke2Router.onRequest('channel-2', ({senderId, requestId, request}) => {
      assert.equal(request.toString(), 'request from spoke 1 on channel 2')
      spoke2Router.respond(requestId, 'response from spoke 2 on channel 2')
    })

    {
      const response = await spoke1Router.request('spoke-2', 'channel-1', 'request from spoke 1 on channel 1')
      assert.equal(response.toString(), 'response from spoke 2 on channel 1')
    }

    {
      const response = await spoke1Router.request('spoke-2', 'channel-2', 'request from spoke 1 on channel 2')
      assert.equal(response.toString(), 'response from spoke 2 on channel 2')
    }

    // Ensure requests and responses with no body are allowed
    {
      spoke2Router.onRequest('channel-3', ({senderId, requestId, request}) => {
        assert.equal(request.length, 0)
        spoke2Router.respond(requestId)
      })
      const response = await spoke1Router.request('spoke-2', 'channel-3')
      assert.equal(response.length, 0)
    }

    // Ensure that multiple responses are disallowed
    {
      spoke2Router.onRequest('channel-4', ({senderId, requestId, request}) => {
        spoke2Router.respond(requestId, 'response from spoke 2 on channel 4')
        assert.throws(
          () => spoke2Router.respond(requestId, 'duplicate response'),
          'Multiple responses to the same request are not allowed'
        )
      })

      await spoke1Router.request('spoke-2', 'channel-4', 'request from spoke 1 on channel 3')
    }
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

function recordTracks (router, channelIds) {
  if (!router.testTracks) router.testTracks = {}
  channelIds.forEach((channelId) => {
    router.testTracks[channelId] = {}
    router.onTrack(channelId, ({senderId, metadata, track}) => {
      router.testTracks[channelId][track.id] = {
        senderId, metadata: metadata.toString(), track
      }
    })
  })
}
