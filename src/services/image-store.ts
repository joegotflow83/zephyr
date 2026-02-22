/**
 * ImageStore — CRUD operations for persisted ZephyrImage records.
 *
 * Runs in the Electron main process. All reads and writes go through
 * ConfigManager so data is stored atomically in ~/.zephyr/images.json.
 *
 * Why a separate service from ConfigManager: ConfigManager handles raw JSON
 * I/O; ImageStore owns the domain logic — ID generation, timestamp updates,
 * duplicate detection, and not-found handling. Mirrors ProjectStore patterns.
 */

import { randomUUID } from 'crypto';
import { ZephyrImage } from '../shared/models';
import { ConfigManager } from './config-manager';

const IMAGES_FILE = 'images.json';

export class ImageStore {
  private readonly config: ConfigManager;

  constructor(config: ConfigManager) {
    this.config = config;
  }

  /**
   * Returns all stored images. Returns an empty array when no file exists yet.
   */
  listImages(): ZephyrImage[] {
    return this.load();
  }

  /**
   * Returns a single image by ID, or null if not found.
   */
  getImage(id: string): ZephyrImage | null {
    return this.load().find((img) => img.id === id) ?? null;
  }

  /**
   * Adds a new image to the store.
   *
   * Assigns a UUID and builtAt timestamp. Throws if an image with the same ID
   * already exists (duplicate detection guard).
   *
   * @param image - Image data without id or builtAt
   * @returns The fully populated ZephyrImage that was saved
   */
  addImage(image: Omit<ZephyrImage, 'id' | 'builtAt'>): ZephyrImage {
    const images = this.load();
    const newImage: ZephyrImage = {
      ...image,
      id: randomUUID(),
      builtAt: new Date().toISOString(),
    };

    const duplicate = images.find((img) => img.id === newImage.id);
    if (duplicate) {
      throw new Error(`Image with id "${newImage.id}" already exists`);
    }

    images.push(newImage);
    this.save(images);
    return newImage;
  }

  /**
   * Merges partial changes into an existing image record.
   *
   * Throws if the image is not found. Note: id and builtAt can be updated
   * explicitly via partial (e.g. rebuildImage updates builtAt).
   *
   * @param id - The UUID of the image to update
   * @param partial - Fields to merge into the existing record
   * @returns The updated ZephyrImage
   */
  updateImage(id: string, partial: Partial<ZephyrImage>): ZephyrImage {
    const images = this.load();
    const index = images.findIndex((img) => img.id === id);

    if (index === -1) {
      throw new Error(`Image with id "${id}" not found`);
    }

    const updated: ZephyrImage = {
      ...images[index],
      ...partial,
      // Preserve the original id — callers must not change it via update
      id,
    };

    images[index] = updated;
    this.save(images);
    return updated;
  }

  /**
   * Removes an image by ID.
   *
   * @returns true if the image was found and removed, false if not found
   */
  removeImage(id: string): boolean {
    const images = this.load();
    const index = images.findIndex((img) => img.id === id);

    if (index === -1) {
      return false;
    }

    images.splice(index, 1);
    this.save(images);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private load(): ZephyrImage[] {
    return this.config.loadJson<ZephyrImage[]>(IMAGES_FILE) ?? [];
  }

  private save(images: ZephyrImage[]): void {
    this.config.saveJson(IMAGES_FILE, images);
  }
}
