module.exports =
function timeout (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
