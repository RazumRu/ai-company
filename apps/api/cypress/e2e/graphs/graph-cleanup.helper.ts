import { GraphDto } from '../../api-definitions';
import { reqHeaders } from '../common.helper';
import { deleteGraph, destroyGraph } from './graphs.helper';

/**
 * Global graph cleanup manager for e2e tests
 * Tracks all created graphs and ensures they are properly cleaned up
 */
class GraphCleanupManager {
  private createdGraphIds: Set<string> = new Set();
  private isCleanupRunning = false;

  /**
   * Register a graph ID for cleanup
   */
  registerGraph(graphId: string): void {
    if (graphId) {
      this.createdGraphIds.add(graphId);
    }
  }

  /**
   * Register multiple graph IDs for cleanup
   */
  registerGraphs(graphIds: string[]): void {
    graphIds.forEach((id) => this.registerGraph(id));
  }

  /**
   * Unregister a graph ID (when it's already been cleaned up)
   */
  unregisterGraph(graphId: string): void {
    this.createdGraphIds.delete(graphId);
  }

  /**
   * Get all registered graph IDs
   */
  getRegisteredGraphs(): string[] {
    return Array.from(this.createdGraphIds);
  }

  /**
   * Clear all registered graph IDs
   */
  clearRegisteredGraphs(): void {
    this.createdGraphIds.clear();
  }

  /**
   * Clean up a single graph (destroy if running, then delete)
   */
  private cleanupSingleGraph(graphId: string): void {
    if (!graphId) return;

    cy.log(`Cleaning up graph: ${graphId}`);

    // First, try to destroy the graph if it's running
    destroyGraph(graphId).then((destroyResponse) => {
      if (destroyResponse.status === 201 || destroyResponse.status === 200) {
        cy.log(`Graph ${graphId} destroyed successfully`);
      }
      
      // Then delete the graph
      deleteGraph(graphId).then((deleteResponse) => {
        if (deleteResponse.status === 200) {
          cy.log(`Graph ${graphId} deleted successfully`);
        } else {
          cy.log(`Failed to delete graph ${graphId}: ${deleteResponse.status}`);
        }
      });
    });

    // Also try to delete the graph directly (in case destroy failed)
    deleteGraph(graphId).then((deleteResponse) => {
      if (deleteResponse.status === 200) {
        cy.log(`Graph ${graphId} deleted successfully (direct delete)`);
      }
    });
  }

  /**
   * Clean up all registered graphs
   */
  cleanupAllGraphs(): void {
    if (this.isCleanupRunning) {
      cy.log('Cleanup already running, skipping...');
      return;
    }

    this.isCleanupRunning = true;
    const graphIds = this.getRegisteredGraphs();

    if (graphIds.length === 0) {
      cy.log('No graphs to clean up');
      this.isCleanupRunning = false;
      return;
    }

    cy.log(`Starting cleanup of ${graphIds.length} graphs...`);

    // Clean up each graph
    graphIds.forEach((graphId) => {
      this.cleanupSingleGraph(graphId);
    });

    // Clear the registered graphs
    this.clearRegisteredGraphs();
    this.isCleanupRunning = false;

    cy.log('Graph cleanup completed');
  }
}

// Global instance
export const graphCleanup = new GraphCleanupManager();
