module.exports =
function setEqual (a, b) {
  if (a instanceof Array) a = new Set(a)
  if (b instanceof Array) b = new Set(b)

  if (a.size !== b.size) return false

  for (const element of a) {
    if (!b.has(element)) return false
  }

  return true
}
