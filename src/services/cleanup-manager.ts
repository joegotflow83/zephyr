import { DockerManager } from './docker-manager';
import { getLogger } from './logging';

const logger = getLogger('cleanup');

/**
 * CleanupManager tracks Docker containers and cleans them up on application exit.
 * This prevents orphaned containers when the app quits unexpectedly.
 */
export class CleanupManager {
  private trackedContainers: Set<string>;
  private dockerManager: DockerManager;

  constructor(dockerManager: DockerManager) {
    this.dockerManager = dockerManager;
    this.trackedContainers = new Set();
  }

  /**
   * Register a container ID for cleanup tracking.
   * @param id - Docker container ID
   */
  registerContainer(id: string): void {
    if (!id || typeof id !== 'string') {
      logger.warn('Attempted to register invalid container ID', { id });
      return;
    }

    this.trackedContainers.add(id);
    logger.debug('Container registered for cleanup', { containerId: id, total: this.trackedContainers.size });
  }

  /**
   * Unregister a container ID from cleanup tracking.
   * Call this when a container is properly stopped/removed through normal flow.
   * @param id - Docker container ID
   */
  unregisterContainer(id: string): void {
    if (!id || typeof id !== 'string') {
      logger.warn('Attempted to unregister invalid container ID', { id });
      return;
    }

    const removed = this.trackedContainers.delete(id);
    if (removed) {
      logger.debug('Container unregistered from cleanup', { containerId: id, total: this.trackedContainers.size });
    }
  }

  /**
   * Get all currently tracked container IDs.
   * @returns Array of container IDs
   */
  getTrackedContainers(): string[] {
    return Array.from(this.trackedContainers);
  }

  /**
   * Stop and remove all tracked containers.
   * Best-effort cleanup - individual container failures do not stop the process.
   * @returns Promise that resolves when cleanup is complete
   */
  async cleanupAll(): Promise<void> {
    const containerIds = this.getTrackedContainers();

    if (containerIds.length === 0) {
      logger.info('No containers to clean up');
      return;
    }

    logger.info('Starting cleanup of tracked containers', { count: containerIds.length });

    const results = await Promise.allSettled(
      containerIds.map(async (containerId) => {
        try {
          logger.debug('Attempting to stop container', { containerId });
          await this.dockerManager.stopContainer(containerId);

          logger.debug('Attempting to remove container', { containerId });
          await this.dockerManager.removeContainer(containerId);

          this.trackedContainers.delete(containerId);
          logger.info('Container cleaned up successfully', { containerId });
        } catch (error) {
          logger.error('Failed to clean up container', {
            containerId,
            error: error instanceof Error ? error.message : String(error)
          });
          // Don't re-throw - best-effort cleanup
        }
      })
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    logger.info('Cleanup completed', {
      total: containerIds.length,
      succeeded,
      failed,
      remaining: this.trackedContainers.size
    });
  }
}
