import type { Tool } from './types.js';
import { eaiErpPost } from './eaiErp.js';

interface CatalogItem {
  skuCode?: string;
  name?: string;
  attributes?: string;
  basePrice?: number;
  tierPrices?: string;
  unit?: string;
}
interface CatalogRule {
  name?: string;
  enabled?: boolean;
  priority?: number;
  trigger?: string;
  action?: string;
}

/**
 * Grounding tool: list the item master + pricing rules so the model emits real skuCodes
 * and attribute keys the rule engine recognizes. Call before create_quote_from_spec.
 */
export const quoteCatalogTool: Tool = {
  name: 'list_quote_catalog',
  description:
    'List the eai-erp quote catalog: item master (skuCode, name, attributes, base/tier prices, unit) and active pricing rules. Call this FIRST before create_quote_from_spec so you use real skuCodes and attribute keys the rule engine recognizes (e.g. a rule that surcharges when 厚度 > 18).',
  parameters: { type: 'object', properties: {} },
  async run() {
    const items = await eaiErpPost<{ list?: CatalogItem[] } | CatalogItem[]>('/api/quote/items/query', {
      pageSize: 200,
    });
    if (!items.ok) return `Error: ${items.error}`;
    const rules = await eaiErpPost<CatalogRule[]>('/api/quote/rules/query', {});
    if (!rules.ok) return `Error: ${rules.error}`;

    const itemList = Array.isArray(items.data) ? items.data : (items.data?.list ?? []);
    const itemLines = itemList.length
      ? itemList
          .map(
            (i) =>
              `  - ${i.skuCode ?? '(no sku)'} | ${i.name ?? ''} | base=${i.basePrice ?? ''}` +
              `${i.tierPrices ? ` | tiers=${i.tierPrices}` : ''}` +
              `${i.unit ? ` | unit=${i.unit}` : ''}` +
              `${i.attributes ? ` | attrs=${i.attributes}` : ''}`,
          )
          .join('\n')
      : '  (no items)';

    const ruleLines = rules.data.length
      ? rules.data
          .map(
            (r) =>
              `  - ${r.name ?? ''}${r.enabled === false ? ' [disabled]' : ''} | when=${r.trigger ?? ''} | then=${r.action ?? ''}`,
          )
          .join('\n')
      : '  (no rules)';

    return `ITEMS (skuCode | name | prices | unit | attributes):\n${itemLines}\n\nRULES (name | when | then):\n${ruleLines}`;
  },
};
