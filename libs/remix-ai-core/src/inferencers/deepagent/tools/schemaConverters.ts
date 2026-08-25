import { z } from 'zod'
import { IMCPToolResult } from '../../../types/mcp'

export function sanitizeToolName(name: string | undefined): string | null {
  if (!name || typeof name !== 'string') return null
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[_-]+/, '')
    .slice(0, 64)
    .replace(/[_-]+$/, '')
  return cleaned.length > 0 ? cleaned : null
}

/**
 * Convert JSON Schema to Zod schema
 * @param schema - JSON Schema object
 * @returns Zod object schema
 */
export function jsonSchemaToZod(schema: any): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {}

  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties as Record<string, any>)) {
      let zodType: z.ZodTypeAny

      switch (prop.type) {
      case 'string':
        if (Array.isArray(prop.enum) && prop.enum.length > 0 && prop.enum.every((v: any) => typeof v === 'string')) {
          zodType = z.enum(prop.enum as [string, ...string[]])
        } else {
          zodType = z.string()
        }
        if (prop.description) zodType = zodType.describe(prop.description)
        break
      case 'number':
        zodType = z.number()
        if (prop.description) zodType = zodType.describe(prop.description)
        break
      case 'boolean':
        zodType = z.boolean()
        if (prop.description) zodType = zodType.describe(prop.description)
        break
      case 'array':
        zodType = z.array(z.any())
        if (prop.description) zodType = zodType.describe(prop.description)
        break
      case 'object':
        zodType = z.record(z.string(), z.any())
        if (prop.description) zodType = zodType.describe(prop.description)
        break
      default:
        zodType = z.any()
      }

      // Make optional if not required
      if (!schema.required?.includes(key)) {
        zodType = zodType.optional()
      }

      shape[key] = zodType
    }
  }

  return z.object(shape)
}

export function mcpResultToString(result: IMCPToolResult): string {
  if (result.isError) {
    const errorText = result.content.find(c => c.type === 'text')?.text || 'Unknown error'
    return `Error: ${errorText}`
  }

  return result.content
    .map(c => {
      if (c.type === 'text') return c.text
      if (c.type === 'image') return `[Image: ${c.mimeType}]`
      if (c.type === 'resource') return `[Resource: ${c.mimeType}]`
      return ''
    })
    .filter(Boolean)
    .join('\n')
}
