class ClientOutOfDateError extends Error {
  constructor () {
    super(...arguments)
  }
}

class NetworkConnectionError extends Error {
  constructor () {
    super(...arguments)
  }
}

class InvalidAuthTokenError extends Error {
  constructor () {
    super('The server did not recognize the provided OAuth token')
  }
}

class PeerConnectionError extends Error {
  constructor () {
    super(...arguments)
  }
}

class PortalCreationError extends Error {
  constructor () {
    super(...arguments)
  }
}

class PortalJoinError extends Error {
  constructor () {
    super(...arguments)
  }
}

class PortalNotFoundError extends Error {
  constructor () {
    super(...arguments)
  }
}

class PubSubConnectionError extends Error {
  constructor () {
    super(...arguments)
  }
}

module.exports = {
  ClientOutOfDateError,
  NetworkConnectionError,
  InvalidAuthTokenError,
  PeerConnectionError,
  PortalCreationError,
  PortalJoinError,
  PortalNotFoundError,
  PubSubConnectionError
}
