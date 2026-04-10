/**
 * Taxonomy Tree Builder
 *
 * Converts a flat list of TaxonomyNode rows (from the DB) into a nested
 * tree structure using parent_id relationships. Runs entirely in memory —
 * no additional DB queries required.
 */

import type { TaxonomyNode } from '../../types/taxonomy';

/**
 * Builds a nested tree from a flat array of taxonomy nodes.
 * Nodes are sorted by display_order within each level.
 * Deprecated nodes are excluded unless includeDeprecated is true.
 */
export function buildTree(
  flatNodes: TaxonomyNode[],
  includeDeprecated = false,
): TaxonomyNode[] {
  const nodes = includeDeprecated
    ? flatNodes
    : flatNodes.filter(n => !n.deprecated);

  // Index by id for O(1) parent lookup
  const byId = new Map<string, TaxonomyNode & { children: TaxonomyNode[] }>();
  for (const node of nodes) {
    byId.set(node.id, { ...node, children: [] });
  }

  const roots: (TaxonomyNode & { children: TaxonomyNode[] })[] = [];

  for (const node of byId.values()) {
    if (node.parent_id === null) {
      roots.push(node);
    } else {
      const parent = byId.get(node.parent_id);
      if (parent) {
        parent.children.push(node);
      }
      // Orphaned nodes (parent deprecated/missing) are silently dropped
    }
  }

  // Sort each level by display_order, then name as tiebreaker
  sortLevel(roots);
  return roots;
}

/**
 * Flattens a tree back to a depth-first ordered array.
 * Useful for generating ordered lists for AI prompts.
 */
export function flattenTree(tree: TaxonomyNode[]): TaxonomyNode[] {
  const result: TaxonomyNode[] = [];
  for (const node of tree) {
    result.push(node);
    if (node.children?.length) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
}

/**
 * Renders the taxonomy as a compact text outline for use in AI prompts.
 * Example output:
 *   ecommerce/
 *     product/
 *       view_item          — User views a product detail page
 *       add_to_cart        — User adds a product to their cart
 */
export function renderTaxonomyForPrompt(tree: TaxonomyNode[]): string {
  const lines: string[] = [];
  renderLevel(tree, 0, lines);
  return lines.join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sortLevel(nodes: TaxonomyNode[]): void {
  nodes.sort((a, b) => {
    if (a.display_order !== b.display_order) return a.display_order - b.display_order;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.children?.length) sortLevel(node.children);
  }
}

function renderLevel(nodes: TaxonomyNode[], depth: number, lines: string[]): void {
  const indent = '  '.repeat(depth);
  for (const node of nodes) {
    if (node.node_type === 'category') {
      lines.push(`${indent}${node.path}/`);
      if (node.children?.length) {
        renderLevel(node.children, depth + 1, lines);
      }
    } else {
      const desc = node.description ? ` — ${node.description}` : '';
      lines.push(`${indent}${node.path}${desc}`);
    }
  }
}
