export interface ExtractedEntity {
  type: 'phone' | 'name' | 'email' | 'address'
  value: string
  context: string
  confidence: 'high' | 'medium' | 'low'
  startOffset: number
  endOffset: number
}

export function extractContactEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = []

  // Phone numbers — various US/international formats
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+\d{1,3}[-.\s]?\d{6,14}/g
  for (const match of text.matchAll(phoneRegex)) {
    const contextStart = Math.max(0, match.index - 30)
    const contextEnd = Math.min(text.length, match.index + match[0].length + 30)
    entities.push({
      type: 'phone',
      value: match[0].trim(),
      context: text.slice(contextStart, contextEnd),
      confidence: match[0].startsWith('+') ? 'high' : 'medium',
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    })
  }

  // Email addresses
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
  for (const match of text.matchAll(emailRegex)) {
    const contextStart = Math.max(0, match.index - 30)
    const contextEnd = Math.min(text.length, match.index + match[0].length + 30)
    entities.push({
      type: 'email',
      value: match[0],
      context: text.slice(contextStart, contextEnd),
      confidence: 'high',
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    })
  }

  // Names with relationship context (case-insensitive prefix, capitalized name capture)
  const nameRegex =
    /(?:(?:[Mm]y|[Hh]is|[Hh]er|[Tt]heir)\s+(?:sister|brother|mother|father|wife|husband|partner|friend|lawyer|attorney|case\s*worker|counselor|doctor)\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g
  for (const match of text.matchAll(nameRegex)) {
    const contextStart = Math.max(0, match.index - 20)
    const contextEnd = Math.min(text.length, match.index + match[0].length + 20)
    entities.push({
      type: 'name',
      value: match[1],
      context: text.slice(contextStart, contextEnd),
      confidence: 'medium',
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    })
  }

  // Named introductions ("my name is", "I'm", "this is", "call me")
  const introRegex =
    /(?:(?:[Mm]y name is|I'm|i'm|[Tt]his is|[Cc]all me)\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g
  for (const match of text.matchAll(introRegex)) {
    const contextStart = Math.max(0, match.index - 20)
    const contextEnd = Math.min(text.length, match.index + match[0].length + 20)
    entities.push({
      type: 'name',
      value: match[1],
      context: text.slice(contextStart, contextEnd),
      confidence: 'high',
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    })
  }

  return entities
}
