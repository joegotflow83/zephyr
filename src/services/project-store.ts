/**
 * ProjectStore — CRUD operations for persisted ProjectConfig records.
 *
 * Runs in the Electron main process. All reads and writes go through
 * ConfigManager so data is stored atomically in ~/.zephyr/projects.json.
 *
 * Why a separate service from ConfigManager: ConfigManager handles raw JSON
 * I/O; ProjectStore owns the domain logic — ID generation, timestamp updates,
 * duplicate detection, and not-found handling.
 */

import { ProjectConfig, createProjectConfig } from '../shared/models';
import { ConfigManager } from './config-manager';

const PROJECTS_FILE = 'projects.json';

export class ProjectStore {
  private readonly config: ConfigManager;

  constructor(config: ConfigManager) {
    this.config = config;
  }

  /**
   * Returns all stored projects. Returns an empty array when no file exists yet.
   */
  listProjects(): ProjectConfig[] {
    return this.load();
  }

  /**
   * Returns a single project by ID, or null if not found.
   */
  getProject(id: string): ProjectConfig | null {
    return this.load().find((p) => p.id === id) ?? null;
  }

  /**
   * Adds a new project to the store.
   *
   * Assigns a UUID and timestamps if not already present.
   * Throws if a project with the same ID already exists (duplicate detection).
   *
   * @param config - Partial or full project configuration
   * @returns The fully populated ProjectConfig that was saved
   */
  addProject(config: Partial<ProjectConfig>): ProjectConfig {
    const projects = this.load();
    const newProject = createProjectConfig(config);

    const duplicate = projects.find((p) => p.id === newProject.id);
    if (duplicate) {
      throw new Error(`Project with id "${newProject.id}" already exists`);
    }

    projects.push(newProject);
    this.save(projects);
    return newProject;
  }

  /**
   * Merges partial changes into an existing project and updates `updated_at`.
   *
   * Throws if the project is not found.
   *
   * @param id - The UUID of the project to update
   * @param partial - Fields to merge into the existing record
   * @returns The updated ProjectConfig
   */
  updateProject(id: string, partial: Partial<ProjectConfig>): ProjectConfig {
    const projects = this.load();
    const index = projects.findIndex((p) => p.id === id);

    if (index === -1) {
      throw new Error(`Project with id "${id}" not found`);
    }

    const updated: ProjectConfig = {
      ...projects[index],
      ...partial,
      // Preserve the original id — callers must not change it via update
      id,
      // Always refresh updated_at on every update
      updated_at: new Date().toISOString(),
    };

    projects[index] = updated;
    this.save(projects);
    return updated;
  }

  /**
   * Removes a project by ID.
   *
   * @returns true if the project was found and removed, false if not found
   */
  removeProject(id: string): boolean {
    const projects = this.load();
    const index = projects.findIndex((p) => p.id === id);

    if (index === -1) {
      return false;
    }

    projects.splice(index, 1);
    this.save(projects);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private load(): ProjectConfig[] {
    return this.config.loadJson<ProjectConfig[]>(PROJECTS_FILE) ?? [];
  }

  private save(projects: ProjectConfig[]): void {
    this.config.saveJson(PROJECTS_FILE, projects);
  }
}
