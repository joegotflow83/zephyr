/**
 * ProjectDialog — modal for adding or editing a project.
 *
 * Includes:
 * - Name, Repo URL fields with validation
 * - Docker image picker: toggle between image library and custom text input
 * - "Build New Image" shortcut that opens ImageBuilderDialog inline
 * - Custom prompt management via PromptEditor
 */

import React, { useState, useEffect } from 'react';
import { ProjectConfig, createProjectConfig } from '../../../shared/models';
import type { ZephyrImage } from '../../../shared/models';
import { PromptEditor } from './PromptEditor';
import { PreValidationSection } from './PreValidationSection';
import { HooksSection } from './HooksSection';
import { useImages } from '../../hooks/useImages';
import { ImageBuilderDialog } from '../ImageBuilderDialog/ImageBuilderDialog';

interface ProjectDialogProps {
  mode: 'add' | 'edit';
  project?: ProjectConfig;
  onSave: (config: ProjectConfig) => void;
  onClose: () => void;
}

type ImageMode = 'library' | 'custom';

/**
 * Modal dialog for adding or editing a project.
 * Includes form validation and custom prompt management.
 */
export const ProjectDialog: React.FC<ProjectDialogProps> = ({ mode, project, onSave, onClose }) => {
  const { images, refresh: refreshImages } = useImages();

  // Form fields
  const [name, setName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [dockerImage, setDockerImage] = useState('ubuntu:24.04');
  const [customPrompts, setCustomPrompts] = useState<Record<string, string>>({});
  const [preValidationScripts, setPreValidationScripts] = useState<string[]>([]);
  const [hooks, setHooks] = useState<string[]>([]);

  // Image picker state: library = pick from ZephyrImage library, custom = free-text
  const [imageMode, setImageMode] = useState<ImageMode>('custom');
  const [imageId, setImageId] = useState<string | undefined>(undefined);
  const [showImageBuilder, setShowImageBuilder] = useState(false);

  // GitHub SSH Access state
  const [githubPat, setGithubPat] = useState('');
  const [hasStoredPat, setHasStoredPat] = useState(false);
  const [showGithubSection, setShowGithubSection] = useState(false);

  // Validation state
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  // Fetch images when the dialog opens so the library is always up to date.
  useEffect(() => {
    refreshImages();
  }, [refreshImages]);

  // Initialize form from project data in edit mode, or set defaults for add mode.
  // Default image mode: library if images exist, custom if library is empty.
  useEffect(() => {
    if (mode === 'edit' && project) {
      setName(project.name);
      setRepoUrl(project.repo_url);
      setLocalPath(project.local_path ?? '');
      setDockerImage(project.docker_image);
      setCustomPrompts(project.custom_prompts);
      setPreValidationScripts(project.pre_validation_scripts ?? []);
      setHooks(project.hooks ?? []);
      setImageId(project.image_id);
      setImageMode(project.image_id ? 'library' : images.length > 0 ? 'library' : 'custom');
      // Check if a GitHub PAT is already stored for this project
      void window.api.githubPat.has(project.id).then(setHasStoredPat);
    } else {
      // Add mode: default to library if images exist, custom if empty
      setImageMode(images.length > 0 ? 'library' : 'custom');
      setImageId(undefined);
      setPreValidationScripts([]);
      setHooks([]);
      setHasStoredPat(false);
    }
    setGithubPat('');
  }, [mode, project, images.length]);

  // Validate repo URL (git/remote URLs only)
  const validateRepoUrl = (url: string): boolean => {
    if (!url) return true; // Optional field
    const urlPattern = /^(https?:\/\/|git@|git:\/\/)/i;
    return urlPattern.test(url);
  };

  // Validate local path (must be an absolute path)
  const validateLocalPath = (path: string): boolean => {
    if (!path) return true; // Optional field
    return path.startsWith('/');
  };

  // Check whether the current repo URL points to GitHub (drives GitHub SSH Access section visibility)
  const isGithubRepo = repoUrl.trim().toLowerCase().includes('github.com');

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate fields
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'Project name is required';
    }

    const trimmedRepoUrl = repoUrl.trim();
    if (trimmedRepoUrl && !validateRepoUrl(trimmedRepoUrl)) {
      newErrors.repoUrl = 'Must be a valid git URL (https://, git@, or git://)';
    }

    const trimmedLocalPath = localPath.trim();
    if (trimmedLocalPath && !validateLocalPath(trimmedLocalPath)) {
      newErrors.localPath = 'Must be an absolute path (starting with /)';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Resolve effective docker image and image_id based on current picker mode
    const selectedImage: ZephyrImage | undefined =
      imageMode === 'library' ? images.find((img) => img.id === imageId) : undefined;
    const effectiveDockerImage = selectedImage ? selectedImage.dockerTag : dockerImage.trim();
    const effectiveImageId = selectedImage ? selectedImage.id : undefined;

    // Build config object
    const config: ProjectConfig =
      mode === 'edit' && project
        ? {
            ...project,
            name: name.trim(),
            repo_url: trimmedRepoUrl,
            local_path: trimmedLocalPath || undefined,
            docker_image: effectiveDockerImage,
            image_id: effectiveImageId,
            pre_validation_scripts: preValidationScripts,
            hooks,
            custom_prompts: customPrompts,
            updated_at: new Date().toISOString(),
          }
        : createProjectConfig({
            name: name.trim(),
            repo_url: trimmedRepoUrl,
            local_path: trimmedLocalPath || undefined,
            docker_image: effectiveDockerImage,
            image_id: effectiveImageId,
            pre_validation_scripts: preValidationScripts,
            hooks,
            custom_prompts: customPrompts,
          });

    // Store GitHub PAT if the user entered one (uses config.id so it works in both add and edit mode)
    if (githubPat.trim()) {
      await window.api.githubPat.set(config.id, githubPat.trim());
    }

    onSave(config);
  };

  // Handle backdrop click to close
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // When a new image is successfully built, auto-select it in library mode
  const handleImageBuilt = (newImage: ZephyrImage) => {
    setShowImageBuilder(false);
    setImageMode('library');
    setImageId(newImage.id);
  };

  // Common Docker images for suggestions (custom mode only)
  const dockerImageSuggestions = [
    'ubuntu:24.04',
    'ubuntu:22.04',
    'python:3.11',
    'python:3.12',
    'node:20',
    'node:22',
  ];

  return (
    <>
      <div
        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200]"
        onClick={handleBackdropClick}
      >
        <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-700">
            <h2 className="text-xl font-bold text-white">
              {mode === 'add' ? 'Add New Project' : 'Edit Project'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
              aria-label="Close dialog"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6">
            {/* Name field */}
            <div className="mb-4">
              <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-2">
                Project Name <span className="text-red-400">*</span>
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setErrors((prev) => ({ ...prev, name: '' }));
                }}
                className={`w-full px-3 py-2 bg-gray-700 border ${
                  errors.name ? 'border-red-500' : 'border-gray-600'
                } rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500`}
                placeholder="My AI Project"
                autoFocus
              />
              {errors.name && <p className="mt-1 text-sm text-red-400">{errors.name}</p>}
            </div>

            {/* Repo URL field */}
            <div className="mb-4">
              <label htmlFor="repoUrl" className="block text-sm font-medium text-gray-300 mb-2">
                Repository URL
              </label>
              <input
                id="repoUrl"
                type="text"
                value={repoUrl}
                onChange={(e) => {
                  setRepoUrl(e.target.value);
                  setErrors((prev) => ({ ...prev, repoUrl: '' }));
                }}
                className={`w-full px-3 py-2 bg-gray-700 border ${
                  errors.repoUrl ? 'border-red-500' : 'border-gray-600'
                } rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500`}
                placeholder="https://github.com/user/repo"
              />
              {errors.repoUrl && (
                <p className="mt-1 text-sm text-red-400">{errors.repoUrl}</p>
              )}
              <p className="mt-1 text-xs text-gray-400">
                Git repository URL (optional) — e.g. https://github.com/user/repo or git@github.com:user/repo
              </p>
            </div>

            {/* Local Path field */}
            <div className="mb-4">
              <label htmlFor="localPath" className="block text-sm font-medium text-gray-300 mb-2">
                Local Path
              </label>
              <input
                id="localPath"
                type="text"
                value={localPath}
                onChange={(e) => {
                  setLocalPath(e.target.value);
                  setErrors((prev) => ({ ...prev, localPath: '' }));
                }}
                className={`w-full px-3 py-2 bg-gray-700 border ${
                  errors.localPath ? 'border-red-500' : 'border-gray-600'
                } rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500`}
                placeholder="/home/user/my-project"
              />
              {errors.localPath && (
                <p className="mt-1 text-sm text-red-400">{errors.localPath}</p>
              )}
              <p className="mt-1 text-xs text-gray-400">
                Absolute path on your machine to mount into the container at <code className="bg-gray-700 px-1 rounded">/workspace</code> (optional)
              </p>
            </div>

            {/* Docker Image section — library picker or custom text input */}
            <div className="mb-4">
              <div className="text-sm font-medium text-gray-300 mb-2">Docker Image</div>

              {/* Mode toggle: library vs custom */}
              <div className="flex gap-4 mb-3">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                  <input
                    type="radio"
                    value="library"
                    checked={imageMode === 'library'}
                    onChange={() => setImageMode('library')}
                    name="image-mode"
                  />
                  Select from Library
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                  <input
                    type="radio"
                    value="custom"
                    checked={imageMode === 'custom'}
                    onChange={() => setImageMode('custom')}
                    name="image-mode"
                  />
                  Custom Image
                </label>
              </div>

              {/* Library mode: dropdown of ZephyrImage entries */}
              {imageMode === 'library' && (
                <div>
                  <select
                    aria-label="Docker Image"
                    value={imageId ?? ''}
                    onChange={(e) => setImageId(e.target.value || undefined)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- Select an image --</option>
                    {images.map((img) => (
                      <option key={img.id} value={img.id}>
                        {img.name}
                      </option>
                    ))}
                  </select>
                  {images.length === 0 && (
                    <p className="mt-1 text-xs text-gray-400">
                      No images in library. Use &quot;+ Build New Image&quot; to create one.
                    </p>
                  )}
                </div>
              )}

              {/* Custom mode: free-text docker image input */}
              {imageMode === 'custom' && (
                <div>
                  <input
                    id="dockerImage"
                    type="text"
                    aria-label="Docker Image"
                    value={dockerImage}
                    onChange={(e) => setDockerImage(e.target.value)}
                    list="docker-images"
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="ubuntu:24.04"
                  />
                  <datalist id="docker-images">
                    {dockerImageSuggestions.map((img) => (
                      <option key={img} value={img} />
                    ))}
                  </datalist>
                  <p className="mt-1 text-xs text-gray-400">
                    Docker image to use for this project&apos;s container
                  </p>
                </div>
              )}

              {/* Build New Image — opens the image builder dialog */}
              <button
                type="button"
                onClick={() => setShowImageBuilder(true)}
                className="mt-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                + Build New Image
              </button>
            </div>

            {/* Pre-Validation Scripts section */}
            <PreValidationSection
              selected={preValidationScripts}
              onChange={setPreValidationScripts}
            />

            {/* Claude Hooks section */}
            <HooksSection selected={hooks} onChange={setHooks} />

            {/* GitHub SSH Access section — only shown when repo URL is a GitHub URL */}
            {isGithubRepo && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-300">
                    GitHub SSH Access
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowGithubSection(!showGithubSection)}
                    className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    {showGithubSection ? 'Hide' : hasStoredPat ? 'Update Token' : 'Set Up'}
                  </button>
                </div>

                {!showGithubSection && hasStoredPat && (
                  <p className="text-xs text-green-400">Token stored — deploy keys will be created automatically on loop start.</p>
                )}

                {showGithubSection && (
                  <div className="bg-gray-750 border border-gray-600 rounded p-4 space-y-3">
                    <div>
                      <input
                        id="githubPat"
                        type="password"
                        value={githubPat}
                        onChange={(e) => setGithubPat(e.target.value)}
                        placeholder={hasStoredPat ? '••••••••••••  (leave blank to keep existing)' : 'github_pat_…'}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        autoComplete="off"
                      />
                      <p className="mt-1 text-xs text-gray-400">
                        Fine-grained PAT with read/write access to repository deploy keys. Scoped to this repo only.{' '}
                        <a
                          href="https://github.com/settings/personal-access-tokens/new"
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 hover:text-blue-300 underline"
                          onClick={(e) => { e.preventDefault(); window.open('https://github.com/settings/personal-access-tokens/new', '_blank'); }}
                        >
                          Create token on GitHub
                        </a>
                      </p>
                    </div>

                    {hasStoredPat && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (mode === 'edit' && project) {
                            await window.api.githubPat.delete(project.id);
                            setHasStoredPat(false);
                            setGithubPat('');
                          }
                        }}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        Remove stored token
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Custom Prompts section */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-300">
                  Custom Prompts
                </label>
                <button
                  type="button"
                  onClick={() => setShowPromptEditor(!showPromptEditor)}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  {showPromptEditor ? 'Hide' : 'Manage Prompts'}
                </button>
              </div>

              {Object.keys(customPrompts).length > 0 && (
                <div className="text-sm text-gray-400 mb-2">
                  {Object.keys(customPrompts).length} custom prompt(s) configured
                </div>
              )}

              {showPromptEditor && (
                <PromptEditor prompts={customPrompts} onChange={setCustomPrompts} />
              )}
            </div>

            {/* Action buttons */}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium"
              >
                {mode === 'add' ? 'Create Project' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ImageBuilderDialog is a sibling so its clicks don't bubble to our backdrop */}
      <ImageBuilderDialog
        isOpen={showImageBuilder}
        onClose={() => setShowImageBuilder(false)}
        onBuilt={handleImageBuilt}
      />
    </>
  );
};
