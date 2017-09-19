const TIMEOUT_SYMBOL = Symbol('timeout')

module.exports = async function throwOnTimeout (promise, ExceptionClass, milliseconds) {
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve(TIMEOUT_SYMBOL), milliseconds)
  })
  const result = await Promise.race([promise, timeoutPromise])
  if (result === TIMEOUT_SYMBOL) {
    throw new ExceptionClass()
  } else {
    return result
  }
}
