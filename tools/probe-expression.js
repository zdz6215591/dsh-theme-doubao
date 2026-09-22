(() => {
  const round = (value) => Math.round(value)
  const rect = (element) => {
    if (!element) return null
    const r = element.getBoundingClientRect()
    return { t: round(r.top), b: round(r.bottom), l: round(r.left), w: round(r.width), h: round(r.height) }
  }
  const host = document.querySelector('[data-doubao-hero]')
  if (host === null) return { error: 'hero slot not mounted' }
  const scroll = host.closest('[data-conversation-scroll]')
  const card = scroll ? scroll.querySelector('[data-slot="conversation.composer.bar"]') : null
  const controls = scroll ? scroll.querySelector('[data-slot="conversation.hero.workspace"]') : null
  const firstSized = (element) => {
    let node = element
    for (let depth = 0; node && depth < 8; depth += 1) {
      const r = node.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) return rect(node)
      node = node.firstElementChild
    }
    return rect(element)
  }
  const character = document.querySelector('[data-doubao-character]')
  const field = document.querySelector('[data-doubao-field]')
  const chain = []
  let node = host
  for (let depth = 0; depth < 8 && node.parentElement; depth += 1) {
    const parent = node.parentElement
    chain.push({
      level: depth,
      element: `${parent.tagName.toLowerCase()}.${String(parent.className || '').slice(0, 24)}`,
      childCount: parent.children.length,
      rect: rect(parent),
      inline: { d: parent.style.display, h: parent.style.height, w: parent.style.width },
    })
    if (parent.children.length > 1) break
    node = parent
  }
  const scrollRect = scroll ? scroll.getBoundingClientRect() : document.documentElement.getBoundingClientRect()
  const cardBox = card ? firstSized(card) : null
  const controlsBox = controls ? firstSized(controls) : null
  const cardTop = cardBox ? cardBox.t : null
  return {
    scrollRect: rect(scroll),
    cardRect: rect(card),
    cardFirstSized: cardBox,
    controlsRect: rect(controls),
    controlsFirstSized: controlsBox,
    hostRect: rect(host),
    chain,
    derived: {
      cardTop: cardTop === null ? null : round(cardTop),
      bandTop: round(scrollRect.top + 8),
      bandBottom: cardTop === null ? null : round(cardTop - 2),
      availH: cardTop === null ? null : round(cardTop - 2 - (scrollRect.top + 8)),
      availW: round(scrollRect.width - 16),
    },
    character: rect(character),
    field: rect(field),
    fieldCanvas: field ? [field.width, field.height, field.clientWidth, field.clientHeight] : null,
    scrollInline: scroll ? { jc: scroll.style.justifyContent, pb: scroll.style.paddingBottom } : null,
    composerBarChildren: card ? Array.from(card.children).map((child) => rect(child)) : null,
    marks: document.querySelectorAll('[data-doubao-mark]').length,
    markRect: rect(document.querySelector('[data-doubao-mark]')),
    name: document.querySelector('[data-doubao-name]')?.textContent ?? null,
    viewport: [window.innerWidth, window.innerHeight],
  }
})()
