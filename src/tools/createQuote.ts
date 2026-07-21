import type { Tool } from './types.js';
import { eaiErpPost } from './eaiErp.js';

interface QuoteLine {
  name?: string;
  qty?: number;
  unitPrice?: number;
  priceOrigin?: string;
}
interface FromSpecResult {
  quotation: {
    quotation: { quoteNo?: string; status?: string };
    totals: { finalAmount?: number; preTax?: number };
    sections: { name?: string; items: QuoteLine[] }[];
  };
  shareToken?: string | null;
  shareUrl?: string | null;
}

/**
 * Create a fully-priced quotation in one call. The backend rule engine auto-prices and
 * auto-appends items; this is a mutating tool, so it only runs in a role's `act` mode.
 */
export const createQuoteTool: Tool = {
  name: 'create_quote_from_spec',
  description:
    'Create a fully-priced quotation in eai-erp from a structured spec in ONE call. The rule engine auto-prices (e.g. a thickness>18 surcharge) and auto-appends items (e.g. adding a door pulls in edge banding). Use real skuCodes from list_quote_catalog so rules fire. Omit unitPrice to let tier/rule pricing decide; set it to force a specific price. Returns the quote number, total, line breakdown, and share link.',
  parameters: {
    type: 'object',
    properties: {
      customerName: { type: 'string', description: 'Customer name; an existing match is reused, else created.' },
      customerTier: { type: 'string', enum: ['S', 'A', 'B', 'C'], description: 'Pricing tier (default C).' },
      siteName: { type: 'string', description: 'Optional install-site name.' },
      enableShare: { type: 'boolean', description: 'Also generate a public share link.' },
      sections: {
        type: 'array',
        description: 'Quote sections, each a named group of line items.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Section name, e.g. 主臥衣櫃.' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  skuCode: { type: 'string', description: 'Catalog SKU (enables rule + tier pricing).' },
                  name: { type: 'string', description: 'Line item display name.' },
                  attributes: {
                    type: 'string',
                    description: 'JSON object string of specs, e.g. {"厚度":"18mm"}. Attribute rules match on this.',
                  },
                  unit: { type: 'string' },
                  unitPrice: { type: 'number', description: 'Force a unit price (skips pricing rules); omit to auto-price.' },
                  qty: { type: 'number', description: 'Quantity (default 1).' },
                },
                required: ['name'],
              },
            },
          },
          required: ['name', 'items'],
        },
      },
    },
    required: ['customerName', 'sections'],
  },
  async run(args) {
    const result = await eaiErpPost<FromSpecResult>('/api/quote/quotations/fromSpec', args);
    if (!result.ok) return `Error: ${result.error}`;

    const d = result.data;
    const q = d.quotation.quotation;
    const totals = d.quotation.totals;
    const lines = d.quotation.sections
      .flatMap((s) =>
        s.items.map(
          (i) =>
            `  - ${i.name} x${i.qty} @ ${i.unitPrice}${i.priceOrigin === 'RULE' ? ' (rule-priced)' : ''}`,
        ),
      )
      .join('\n');
    const share = d.shareUrl
      ? `\nShare: ${d.shareUrl}`
      : d.shareToken
        ? `\nShare token: ${d.shareToken}`
        : '';
    return `Quote ${q.quoteNo} created (${q.status}). Final total: ${totals.finalAmount}.\n${lines}${share}`;
  },
};
