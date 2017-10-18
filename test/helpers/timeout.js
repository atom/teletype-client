module.exports =
function timeout (ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
