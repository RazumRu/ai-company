import { Injectable } from '@nestjs/common';
import {
  applyPatch,
  compare as diffSchemas,
  type Operation,
} from 'fast-json-patch';
import { cloneDeep, isEqual } from 'lodash';

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
 * Service for performing 3-way merges on graph schemas.
 * Implements conflict detection for concurrent edits.
 */
@Injectable()
export class GraphMergeService {
  /**
   * Perform a 3-way merge between base, head, and client schemas.
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
    // Fast path: head and client are identical
    if (isEqual(headSchema, clientSchema)) {
      return { success: true, mergedSchema: clientSchema, conflicts: [] };
    }

    // Fast path: base equals head - client changes apply cleanly
    if (isEqual(baseSchema, headSchema)) {
      return this.validateAndReturn(clientSchema);
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
    const mergedSchema = this.applyMerge(headSchema, baseToClient);

    if (!mergedSchema) {
      return { success: false, conflicts: [] };
    }

    return this.validateAndReturn(mergedSchema);
  }

  private validateAndReturn(schema: GraphSchemaType): MergeResult {
    const structuralCheck = this.checkStructuralIntegrity(schema);
    if (!structuralCheck.valid) {
      return {
        success: false,
        conflicts: structuralCheck.conflicts || [],
      };
    }
    return { success: true, mergedSchema: schema, conflicts: [] };
  }

  private applyMerge(
    headSchema: GraphSchemaType,
    baseToClient: Operation[],
  ): GraphSchemaType | null {
    const mergedSchema = cloneDeep(headSchema);

    try {
      applyPatch(mergedSchema, baseToClient);
      return mergedSchema;
    } catch {
      // Merge application failed - return null to signal failure
      // Caller will handle this as a structural conflict
      return null;
    }
  }

  /**
   * Detect conflicts between base→head and base→client changes.
   */
  private detectConflicts(
    baseSchema: GraphSchemaType,
    headSchema: GraphSchemaType,
    clientSchema: GraphSchemaType,
    baseToHead: Operation[],
    baseToClient: Operation[],
  ): MergeConflict[] {
    const conflicts: MergeConflict[] = [];

    // Check for concurrent modifications
    const headPathsMap = new Map(baseToHead.map((op) => [op.path, op]));
    const clientPathsMap = new Map(baseToClient.map((op) => [op.path, op]));

    for (const [path] of clientPathsMap) {
      if (headPathsMap.has(path)) {
        const conflict = this.createConcurrentModificationConflict(
          path,
          baseSchema,
          headSchema,
          clientSchema,
        );
        if (conflict) {
          conflicts.push(conflict);
        }
      }
    }

    // Check deletion conflicts
    conflicts.push(
      ...this.findDeletionConflicts(
        baseSchema,
        headSchema,
        clientSchema,
        baseToHead,
        baseToClient,
      ),
    );

    return conflicts;
  }

  private createConcurrentModificationConflict(
    path: string,
    baseSchema: GraphSchemaType,
    headSchema: GraphSchemaType,
    clientSchema: GraphSchemaType,
  ): MergeConflict | null {
    const baseValue = this.getValueAtPath(baseSchema, path);
    const headValue = this.getValueAtPath(headSchema, path);
    const clientValue = this.getValueAtPath(clientSchema, path);

    // If both changed to the same value, not a conflict
    if (isEqual(headValue, clientValue)) {
      return null;
    }

    return {
      path,
      type: 'concurrent_modification',
      baseValue,
      headValue,
      clientValue,
      description: `Both head and client modified path: ${path}`,
    };
  }

  private findDeletionConflicts(
    baseSchema: GraphSchemaType,
    headSchema: GraphSchemaType,
    clientSchema: GraphSchemaType,
    baseToHead: Operation[],
    baseToClient: Operation[],
  ): MergeConflict[] {
    const conflicts: MergeConflict[] = [];

    // Client deleted what head modified
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

    // Head deleted what client modified
    const deletedInHead = this.findDeletions(baseSchema, headSchema);
    const clientModifications = baseToClient.filter((op) => op.op !== 'remove');

    for (const deletedPath of deletedInHead) {
      const hasConflict = clientModifications.some(
        (op) =>
          op.path === deletedPath || op.path.startsWith(`${deletedPath}/`),
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
   * Check structural integrity of a schema.
   * Validates that referenced nodes exist in edges.
   * Note: Doesn't check for orphaned nodes as that's validated during compilation.
   */
  private checkStructuralIntegrity(schema: GraphSchemaType): {
    valid: boolean;
    conflicts?: MergeConflict[];
  } {
    const nodeIds = new Set(schema.nodes.map((node) => node.id));
    const conflicts: MergeConflict[] = [];

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
   * Get value at a JSON Patch path.
   */
  private getValueAtPath(obj: unknown, path: string): unknown {
    const parts = path.split('/').filter(Boolean);
    let current = obj;

    for (const part of parts) {
      if (current == null) {
        return undefined;
      }

      if (typeof current === 'object' && part in (current as object)) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Find paths that were deleted between base and target.
   */
  private findDeletions(
    base: GraphSchemaType,
    target: GraphSchemaType,
  ): Set<string> {
    const deletions = new Set<string>();
    const targetNodeIds = new Set(target.nodes.map((n) => n.id));

    base.nodes.forEach((node, index) => {
      if (!targetNodeIds.has(node.id)) {
        deletions.add(`/nodes/${index}`);
      }
    });

    return deletions;
  }
}
