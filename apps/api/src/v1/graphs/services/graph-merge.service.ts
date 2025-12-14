import { Injectable } from '@nestjs/common';
import { BadRequestException as _BadRequestException } from '@packages/common';
import {
  applyPatch,
  compare as diffSchemas,
  type Operation,
} from 'fast-json-patch';
import { cloneDeep, isEqual, isNil, isObject } from 'lodash';

import type { GraphSchemaType } from '../graphs.types';

export interface MergeConflict {
  path: string;
  type: 'concurrent_modification' | 'structural_break' | 'deletion_conflict';
  baseValue: unknown;
  headValue: unknown;
  clientValue: unknown;
  description: string;
}

export interface MergeResult {
  success: boolean;
  mergedSchema?: GraphSchemaType;
  conflicts?: MergeConflict[];
}

/**
 * Service for performing 3-way merges on graph schemas
 * Implements conflict detection for concurrent edits
 */
@Injectable()
export class GraphMergeService {
  /**
   * Perform a 3-way merge between base, head, and client schemas
   *
   * @param baseSchema - The schema the client started from
   * @param headSchema - The current head schema (latest accepted)
   * @param clientSchema - The schema the client is submitting
   * @returns Merge result with merged schema or conflicts
   */
  mergeSchemas(
    baseSchema: GraphSchemaType,
    headSchema: GraphSchemaType,
    clientSchema: GraphSchemaType,
  ): MergeResult {
    // If head and client are the same, no merge needed
    if (isEqual(headSchema, clientSchema)) {
      return { success: true, mergedSchema: clientSchema, conflicts: [] };
    }

    // If base equals head, client changes apply cleanly
    if (isEqual(baseSchema, headSchema)) {
      const structuralCheck = this.checkStructuralIntegrity(clientSchema);
      if (!structuralCheck.valid) {
        return {
          success: false,
          conflicts: structuralCheck.conflicts || [],
        };
      }
      return { success: true, mergedSchema: clientSchema, conflicts: [] };
    }

    // Calculate diffs
    const baseToHead = diffSchemas(baseSchema, headSchema);
    const baseToClient = diffSchemas(baseSchema, clientSchema);

    // Detect conflicts
    const conflicts = this.detectConflicts(
      baseSchema,
      headSchema,
      clientSchema,
      baseToHead,
      baseToClient,
    );

    if (conflicts.length > 0) {
      return { success: false, conflicts };
    }

    // No conflicts - merge head changes with client changes
    // Start with head schema and apply client's changes (base→client diff)
    const mergedSchema = cloneDeep(headSchema);

    // Apply client's changes on top of head using fast-json-patch
    try {
      applyPatch(mergedSchema, baseToClient);
    } catch (error) {
      return {
        success: false,
        conflicts: [
          {
            path: '/',
            type: 'structural_break',
            baseValue: baseSchema,
            headValue: headSchema,
            clientValue: clientSchema,
            description: `Failed to apply merge: ${(error as Error).message}`,
          },
        ],
      };
    }

    // Check structural integrity of merged result
    const structuralCheck = this.checkStructuralIntegrity(mergedSchema);
    if (!structuralCheck.valid) {
      return {
        success: false,
        conflicts: structuralCheck.conflicts || [],
      };
    }

    return { success: true, mergedSchema, conflicts: [] };
  }

  /**
   * Detect conflicts between base→head and base→client changes
   */
  private detectConflicts(
    baseSchema: GraphSchemaType,
    headSchema: GraphSchemaType,
    clientSchema: GraphSchemaType,
    baseToHead: Operation[],
    baseToClient: Operation[],
  ): MergeConflict[] {
    const conflicts: MergeConflict[] = [];

    // Extract affected paths from each diff (keep exact paths, not normalized)
    const headPathsMap = new Map(baseToHead.map((op) => [op.path, op]));
    const clientPathsMap = new Map(baseToClient.map((op) => [op.path, op]));

    // Find concurrent modifications
    for (const [path, _clientOp] of clientPathsMap) {
      const headOp = headPathsMap.get(path);
      if (headOp) {
        const baseValue = this.getValueAtPath(baseSchema, path);
        const headValue = this.getValueAtPath(headSchema, path);
        const clientValue = this.getValueAtPath(clientSchema, path);

        // If both changed to the same value, it's not a conflict
        if (!isEqual(headValue, clientValue)) {
          conflicts.push({
            path,
            type: 'concurrent_modification',
            baseValue,
            headValue,
            clientValue,
            description: `Both head and client modified path: ${path}`,
          });
        }
      }
    }

    // Check for deletion conflicts (client deletes what head modified)
    const deletedInClient = this.findDeletions(baseSchema, clientSchema);
    const modifiedInHead = new Set(
      baseToHead.filter((op) => op.op !== 'remove').map((op) => op.path),
    );

    for (const deletedPath of deletedInClient) {
      if (modifiedInHead.has(deletedPath)) {
        conflicts.push({
          path: deletedPath,
          type: 'deletion_conflict',
          baseValue: this.getValueAtPath(baseSchema, deletedPath),
          headValue: this.getValueAtPath(headSchema, deletedPath),
          clientValue: undefined,
          description: `Client deleted ${deletedPath} which was modified in head`,
        });
      }
    }

    // Check for deletion conflicts (head deletes what client modified)
    const deletedInHead = this.findDeletions(baseSchema, headSchema);
    const clientModifications = baseToClient.filter((op) => op.op !== 'remove');

    for (const deletedPath of deletedInHead) {
      // Check if client modified this deleted item or any of its children
      const hasConflict = clientModifications.some(
        (op) =>
          op.path === deletedPath || op.path.startsWith(deletedPath + '/'),
      );

      if (hasConflict) {
        conflicts.push({
          path: deletedPath,
          type: 'deletion_conflict',
          baseValue: this.getValueAtPath(baseSchema, deletedPath),
          headValue: undefined,
          clientValue: this.getValueAtPath(clientSchema, deletedPath),
          description: `Head deleted ${deletedPath} which was modified in client`,
        });
      }
    }

    return conflicts;
  }

  /**
   * Check structural integrity of a schema
   * Validates: referenced nodes exist in edges
   * Note: Doesn't check for orphaned nodes as that's validated during compilation
   */
  private checkStructuralIntegrity(schema: GraphSchemaType): {
    valid: boolean;
    conflicts?: MergeConflict[];
  } {
    const conflicts: MergeConflict[] = [];

    // Build node ID set
    const nodeIds = new Set(schema.nodes.map((node) => node.id));

    // Check edges reference valid nodes
    for (const edge of schema.edges || []) {
      if (!nodeIds.has(edge.from)) {
        conflicts.push({
          path: `/edges/${edge.from}->${edge.to}`,
          type: 'structural_break',
          baseValue: null,
          headValue: null,
          clientValue: edge,
          description: `Edge references non-existent source node: ${edge.from}`,
        });
      }
      if (!nodeIds.has(edge.to)) {
        conflicts.push({
          path: `/edges/${edge.from}->${edge.to}`,
          type: 'structural_break',
          baseValue: null,
          headValue: null,
          clientValue: edge,
          description: `Edge references non-existent target node: ${edge.to}`,
        });
      }
    }

    return {
      valid: conflicts.length === 0,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    };
  }

  /**
   * Normalize a JSON Patch path for comparison
   */
  private normalizePath(path: string): string {
    // Remove array indices to compare at object level
    return path.replace(/\/\d+/g, '/*');
  }

  /**
   * Get value at a JSON Patch path
   */
  private getValueAtPath(obj: unknown, path: string): unknown {
    const parts = path.split('/').filter(Boolean);
    let current = obj;

    for (const part of parts) {
      if (isNil(current)) {
        return undefined;
      }

      if (isObject(current) && part in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Find paths that were deleted between base and target
   */
  private findDeletions(
    base: GraphSchemaType,
    target: GraphSchemaType,
  ): Set<string> {
    const deletions = new Set<string>();

    // Check for deleted nodes using array indices (as used by JSON Patch)
    const targetNodeIds = new Set(target.nodes.map((n) => n.id));

    base.nodes.forEach((node, index) => {
      if (!targetNodeIds.has(node.id)) {
        deletions.add(`/nodes/${index}`);
      }
    });

    return deletions;
  }
}
