/**
 * ProjectDialog — modal for adding or editing a project.
 *
 * Includes:
 * - Name, Repo URL fields with validation
 * - Docker image picker: toggle between image library and custom text input
 * - "Build New Image" shortcut that opens ImageBuilderDialog inline
 * - Sandbox Type: Container (default) or VM
 * - VM Configuration: mode, resources (CPUs, Memory, Disk), cloud-init YAML
 * - Custom prompt management via PromptEditor
 */

import React, { useState, useEffect } from 'react';
import { ProjectConfig, VMConfig, createProjectConfig, FACTORY_ROLES, FACTORY_ROLE_LABELS } from '../../../shared/models';
import type { FactoryRole, FactoryConfig } from '../../../shared/models';
import type { ZephyrImage } from '../../../shared/models';
import { PromptEditor } from './PromptEditor';
import { SpecFilesSection } from './SpecFilesSection';
import { PreValidationSection } from './PreValidationSection';
import { HooksSection } from './HooksSection';
import { LoopScriptsSection } from './LoopScriptsSection';
import { ClaudeSettingsSection } from './ClaudeSettingsSection';
import { KiroHooksSection } from './KiroHooksSection';
import { useImages } from '../../hooks/useImages';
import { ImageBuilderDialog } from '../ImageBuilderDialog/ImageBuilderDialog';
import { useAppStore } from '../../stores/app-store';

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
  const multipassAvailable = useAppStore((state) => state.multipassAvailable);

  // Form fields
  const [name, setName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [dockerImage, setDockerImage] = useState('ubuntu:24.04');
  const [customPrompts, setCustomPrompts] = useState<Record<string, string>>({});
  const [specFiles, setSpecFiles] = useState<Record<string, string>>({});
  const [preValidationScripts, setPreValidationScripts] = useState<string[]>([]);
  const [hooks, setHooks] = useState<string[]>([]);
  const [loopScript, setLoopScript] = useState<string | undefined>(undefined);
  const [claudeSettingsFile, setClaudeSettingsFile] = useState<string | undefined>(undefined);
  const [kiroConfig, setKiroConfig] = useState('');
  const [kiroHooks, setKiroHooks] = useState<string[]>([]);

  // Image picker state: library = pick from ZephyrImage library, custom = free-text
  const [imageMode, setImageMode] = useState<ImageMode>('custom');
  const [imageId, setImageId] = useState<string | undefined>(undefined);
  const [showImageBuilder, setShowImageBuilder] = useState(false);

  // GitHub SSH Access state
  const [githubPat, setGithubPat] = useState('');
  const [hasStoredPat, setHasStoredPat] = useState(false);
  const [showGithubSection, setShowGithubSection] = useState(false);

  // GitLab SSH Access state
  const [gitlabPat, setGitlabPat] = useState('');
  const [hasStoredGitlabPat, setHasStoredGitlabPat] = useState(false);
  const [showGitlabSection, setShowGitlabSection] = useState(false);

  // Additional mount points
  const [additionalMounts, setAdditionalMounts] = useState<string[]>([]);
  const [newMountPath, setNewMountPath] = useState('');
  const [mountErrors, setMountErrors] = useState<Record<string, string>>({});

  // VM / sandbox state
  const [sandboxType, setSandboxType] = useState<'container' | 'vm'>('container');
  const [vmMode, setVmMode] = useState<'persistent' | 'ephemeral'>('persistent');
  const [vmCpus, setVmCpus] = useState(2);
  const [vmMemoryGb, setVmMemoryGb] = useState(4);
  const [vmDiskGb, setVmDiskGb] = useState(20);
  const [vmCloudInit, setVmCloudInit] = useState('');
  const [showVmAdvanced, setShowVmAdvanced] = useState(false);
  const [showClaudeConfig, setShowClaudeConfig] = useState(false);
  const [showKiroConfig, setShowKiroConfig] = useState(false);

  // Git identity state
  const [gitUserName, setGitUserName] = useState('');
  const [gitUserEmail, setGitUserEmail] = useState('');

  // Factory state
  const [factoryEnabled, setFactoryEnabled] = useState(false);
  const [factoryRoles, setFactoryRoles] = useState<FactoryRole[]>([...FACTORY_ROLES]);
  const [featureRequestsContent, setFeatureRequestsContent] = useState('');

  // Validation state
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [showSpecFilesEditor, setShowSpecFilesEditor] = useState(false);

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
      setLoopScript(project.loop_script);
      setClaudeSettingsFile(project.claude_settings_file);
      setKiroConfig(project.kiro_config ?? '');
      setKiroHooks(project.kiro_hooks ?? []);
      setAdditionalMounts(project.additional_mounts ?? []);
      setImageId(project.image_id);
      setImageMode(project.image_id ? 'library' : images.length > 0 ? 'library' : 'custom');
      // Check if a GitHub PAT is already stored for this project
      void window.api.githubPat.has(project.id).then(setHasStoredPat);
      // Check if a GitLab PAT is already stored for this project
      void window.api.gitlabPat.has(project.id).then(setHasStoredGitlabPat);
      // VM config
      setSandboxType(project.sandbox_type ?? 'container');
      setVmMode(project.vm_config?.vm_mode ?? 'persistent');
      setVmCpus(project.vm_config?.cpus ?? 2);
      setVmMemoryGb(project.vm_config?.memory_gb ?? 4);
      setVmDiskGb(project.vm_config?.disk_gb ?? 20);
      setVmCloudInit(project.vm_config?.cloud_init ?? '');
      // Factory config
      setFactoryEnabled(project.factory_config?.enabled ?? false);
      setFactoryRoles(project.factory_config?.roles ?? [...FACTORY_ROLES]);
      setFeatureRequestsContent(project.feature_requests_content ?? '');
      // Git identity
      setGitUserName(project.git_user_name ?? '');
      setGitUserEmail(project.git_user_email ?? '');
      // Spec files
      setSpecFiles(project.spec_files ?? {});
    } else {
      // Add mode: default to library if images exist, custom if empty
      setImageMode(images.length > 0 ? 'library' : 'custom');
      setImageId(undefined);
      setPreValidationScripts([]);
      setHooks([]);
      setLoopScript(undefined);
      setAdditionalMounts([]);
      setHasStoredPat(false);
      setHasStoredGitlabPat(false);
      // VM defaults
      setSandboxType('container');
      setVmMode('persistent');
      setVmCpus(2);
      setVmMemoryGb(4);
      setVmDiskGb(20);
      setVmCloudInit('');
      // Factory defaults
      setFactoryEnabled(false);
      setFactoryRoles([...FACTORY_ROLES]);
      setFeatureRequestsContent('');
    }
    setGithubPat('');
    setGitlabPat('');
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

  // Add an additional mount path (validates absolute path and no duplicates)
  const handleAddMount = () => {
    const trimmed = newMountPath.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith('/')) {
      setMountErrors((prev) => ({ ...prev, new: 'Must be an absolute path (starting with /)' }));
      return;
    }
    if (additionalMounts.includes(trimmed)) {
      setMountErrors((prev) => ({ ...prev, new: 'This path is already added' }));
      return;
    }
    setAdditionalMounts((prev) => [...prev, trimmed]);
    setNewMountPath('');
    setMountErrors((prev) => { const next = { ...prev }; delete next.new; return next; });
  };

  const handleRemoveMount = (index: number) => {
    setAdditionalMounts((prev) => prev.filter((_, i) => i !== index));
  };

  // Check whether the current repo URL points to GitHub or GitLab (drives SSH Access section visibility)
  const isGithubRepo = repoUrl.trim().toLowerCase().includes('github.com');
  const isGitlabRepo = repoUrl.trim().toLowerCase().includes('gitlab.com');

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

    // Build VM config if sandbox type is VM
    const effectiveVmConfig: VMConfig | undefined =
      sandboxType === 'vm'
        ? {
            vm_mode: vmMode,
            cpus: vmCpus,
            memory_gb: vmMemoryGb,
            disk_gb: vmDiskGb,
            cloud_init: vmCloudInit.trim() || undefined,
          }
        : undefined;

    // Build factory config
    const effectiveFactoryConfig: FactoryConfig | undefined =
      factoryEnabled
        ? { enabled: true, roles: factoryRoles }
        : undefined;

    const effectiveFeatureRequestsContent = featureRequestsContent.trim() || undefined;

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
            loop_script: loopScript,
            claude_settings_file: claudeSettingsFile,
            custom_prompts: customPrompts,
            additional_mounts: additionalMounts.length > 0 ? additionalMounts : undefined,
            updated_at: new Date().toISOString(),
            sandbox_type: sandboxType,
            vm_config: effectiveVmConfig,
            factory_config: effectiveFactoryConfig,
            feature_requests_content: effectiveFeatureRequestsContent,
            kiro_config: kiroConfig.trim() || undefined,
            kiro_hooks: kiroHooks,
            git_user_name: gitUserName.trim() || undefined,
            git_user_email: gitUserEmail.trim() || undefined,
            spec_files: Object.keys(specFiles).length > 0 ? specFiles : undefined,
          }
        : createProjectConfig({
            name: name.trim(),
            repo_url: trimmedRepoUrl,
            local_path: trimmedLocalPath || undefined,
            docker_image: effectiveDockerImage,
            image_id: effectiveImageId,
            pre_validation_scripts: preValidationScripts,
            hooks,
            loop_script: loopScript,
            claude_settings_file: claudeSettingsFile,
            custom_prompts: customPrompts,
            additional_mounts: additionalMounts.length > 0 ? additionalMounts : undefined,
            sandbox_type: sandboxType,
            vm_config: effectiveVmConfig,
            factory_config: effectiveFactoryConfig,
            feature_requests_content: effectiveFeatureRequestsContent,
            kiro_config: kiroConfig.trim() || undefined,
            kiro_hooks: kiroHooks,
            git_user_name: gitUserName.trim() || undefined,
            git_user_email: gitUserEmail.trim() || undefined,
            spec_files: Object.keys(specFiles).length > 0 ? specFiles : undefined,
          });

    // Store GitHub PAT if the user entered one (uses config.id so it works in both add and edit mode)
    if (githubPat.trim()) {
      await window.api.githubPat.set(config.id, githubPat.trim());
    }

    // Store GitLab PAT if the user entered one
    if (gitlabPat.trim()) {
      await window.api.gitlabPat.set(config.id, gitlabPat.trim());
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
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {mode === 'add' ? 'Add New Project' : 'Edit Project'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
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
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
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
                className={`w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border ${
                  errors.name ? 'border-red-500' : 'border-gray-200 dark:border-gray-600'
                } rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500`}
                placeholder="My AI Project"
                autoFocus
              />
              {errors.name && <p className="mt-1 text-sm text-red-400">{errors.name}</p>}
            </div>

            {/* Repo URL field */}
            <div className="mb-4">
              <label htmlFor="repoUrl" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
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
                className={`w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border ${
                  errors.repoUrl ? 'border-red-500' : 'border-gray-200 dark:border-gray-600'
                } rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500`}
                placeholder="https://github.com/user/repo"
              />
              {errors.repoUrl && (
                <p className="mt-1 text-sm text-red-400">{errors.repoUrl}</p>
              )}
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Git repository URL (optional) — e.g. https://github.com/user/repo or git@github.com:user/repo
              </p>
            </div>

            {/* Local Path field */}
            <div className="mb-4">
              <label htmlFor="localPath" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
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
                className={`w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border ${
                  errors.localPath ? 'border-red-500' : 'border-gray-200 dark:border-gray-600'
                } rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500`}
                placeholder="/home/user/my-project"
              />
              {errors.localPath && (
                <p className="mt-1 text-sm text-red-400">{errors.localPath}</p>
              )}
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Absolute path on your machine to mount into the container at <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">/workspace</code> (optional)
              </p>
            </div>

            {/* Git Identity */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Git Identity
              </label>
              <div className="flex gap-3">
                <div className="flex-1">
                  <input
                    id="gitUserName"
                    type="text"
                    value={gitUserName}
                    onChange={(e) => setGitUserName(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Ralph"
                  />
                </div>
                <div className="flex-1">
                  <input
                    id="gitUserEmail"
                    type="text"
                    value={gitUserEmail}
                    onChange={(e) => setGitUserEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="ralph@placeholder.com"
                  />
                </div>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Git <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">user.name</code> and <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">user.email</code> set inside the container (optional — defaults to Ralph / ralph@placeholder.com)
              </p>
            </div>

            {/* Additional Mount Points section */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Additional Mount Points
              </label>

              {/* Existing mounts list */}
              {additionalMounts.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {additionalMounts.map((hostPath, idx) => {
                    const basename = hostPath.split('/').filter(Boolean).pop() ?? hostPath;
                    return (
                      <li
                        key={idx}
                        className="flex items-center justify-between bg-gray-100 dark:bg-gray-700 rounded px-3 py-1.5 text-sm"
                      >
                        <span className="text-gray-800 dark:text-gray-200 font-mono truncate flex-1 mr-2">{hostPath}</span>
                        <span className="text-gray-500 dark:text-gray-400 text-xs mr-3 shrink-0">
                          → <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">/mnt/{basename}</code>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveMount(idx)}
                          className="text-gray-500 hover:text-red-400 transition-colors shrink-0"
                          aria-label={`Remove mount ${hostPath}`}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Add new mount input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newMountPath}
                  onChange={(e) => {
                    setNewMountPath(e.target.value);
                    setMountErrors((prev) => { const next = { ...prev }; delete next.new; return next; });
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddMount(); } }}
                  className={`flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-700 border ${
                    mountErrors.new ? 'border-red-500' : 'border-gray-200 dark:border-gray-600'
                  } rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm`}
                  placeholder="/home/user/data"
                />
                <button
                  type="button"
                  onClick={handleAddMount}
                  className="px-3 py-2 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-900 dark:text-white rounded text-sm transition-colors shrink-0"
                >
                  Add
                </button>
              </div>
              {mountErrors.new && (
                <p className="mt-1 text-sm text-red-400">{mountErrors.new}</p>
              )}
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Extra host paths to mount into the container. Each path mounts at{' '}
                <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">/mnt/&lt;foldername&gt;</code>.
              </p>
            </div>

            {/* Docker Image section — library picker or custom text input */}
            <div className="mb-4">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Docker Image</div>

              {/* Mode toggle: library vs custom */}
              <div className="flex gap-4 mb-3">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="radio"
                    value="library"
                    checked={imageMode === 'library'}
                    onChange={() => setImageMode('library')}
                    name="image-mode"
                  />
                  Select from Library
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
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
                    className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- Select an image --</option>
                    {images.map((img) => (
                      <option key={img.id} value={img.id}>
                        {img.name}
                      </option>
                    ))}
                  </select>
                  {images.length === 0 && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
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
                    className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="ubuntu:24.04"
                  />
                  <datalist id="docker-images">
                    {dockerImageSuggestions.map((img) => (
                      <option key={img} value={img} />
                    ))}
                  </datalist>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
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

            {/* Sandbox Type section */}
            <div className="mb-4">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Sandbox Type</div>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="radio"
                    name="sandbox-type"
                    value="container"
                    checked={sandboxType === 'container'}
                    onChange={() => setSandboxType('container')}
                  />
                  Container
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="radio"
                    name="sandbox-type"
                    value="vm"
                    checked={sandboxType === 'vm'}
                    onChange={() => setSandboxType('vm')}
                  />
                  Virtual Machine
                </label>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {sandboxType === 'container'
                  ? 'Run loops directly in a Docker container (default).'
                  : 'Run loops inside an isolated Ubuntu VM via Multipass. Requires Multipass installed.'}
              </p>
            </div>

            {/* VM Configuration — only shown when sandbox type is VM */}
            {sandboxType === 'vm' && (
              <div className="mb-4 border border-gray-200 dark:border-gray-600 rounded p-4 space-y-4">
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">VM Configuration</div>

                {/* Multipass unavailable warning */}
                {!multipassAvailable && (
                  <div
                    role="alert"
                    className="p-3 bg-yellow-900 bg-opacity-50 border border-yellow-700 rounded text-yellow-200 text-sm"
                  >
                    Multipass is not installed. Visit{' '}
                    <a
                      href="https://multipass.run"
                      onClick={(e) => {
                        e.preventDefault();
                        window.open('https://multipass.run', '_blank');
                      }}
                      className="underline text-yellow-100 hover:text-white"
                    >
                      multipass.run
                    </a>{' '}
                    to install.
                  </div>
                )}

                {/* VM Mode */}
                <div>
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">VM Mode</div>
                  <div className="flex gap-6">
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="radio"
                        name="vm-mode"
                        value="persistent"
                        checked={vmMode === 'persistent'}
                        onChange={() => setVmMode('persistent')}
                      />
                      Persistent
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="radio"
                        name="vm-mode"
                        value="ephemeral"
                        checked={vmMode === 'ephemeral'}
                        onChange={() => setVmMode('ephemeral')}
                      />
                      Ephemeral
                    </label>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {vmMode === 'persistent'
                      ? 'VM persists between loop runs; start and stop independently.'
                      : 'VM is created fresh each run and deleted when done.'}
                  </p>
                </div>

                {/* Resources */}
                <div>
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Resources</div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label htmlFor="vm-cpus" className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                        CPUs
                      </label>
                      <input
                        id="vm-cpus"
                        type="number"
                        min={1}
                        max={16}
                        value={vmCpus}
                        onChange={(e) => setVmCpus(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      />
                    </div>
                    <div className="flex-1">
                      <label htmlFor="vm-memory" className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                        Memory (GB)
                      </label>
                      <input
                        id="vm-memory"
                        type="number"
                        min={1}
                        max={64}
                        value={vmMemoryGb}
                        onChange={(e) => setVmMemoryGb(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      />
                    </div>
                    <div className="flex-1">
                      <label htmlFor="vm-disk" className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                        Disk (GB)
                      </label>
                      <input
                        id="vm-disk"
                        type="number"
                        min={5}
                        max={500}
                        value={vmDiskGb}
                        onChange={(e) => setVmDiskGb(Math.max(5, parseInt(e.target.value, 10) || 5))}
                        className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      />
                    </div>
                  </div>
                </div>

                {/* Advanced: Cloud-init */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowVmAdvanced(!showVmAdvanced)}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                  >
                    Advanced {showVmAdvanced ? '▲' : '▼'}
                  </button>
                  {showVmAdvanced && (
                    <div className="mt-2">
                      <label htmlFor="vm-cloud-init" className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                        Cloud-init YAML (optional override)
                      </label>
                      <textarea
                        id="vm-cloud-init"
                        value={vmCloudInit}
                        onChange={(e) => setVmCloudInit(e.target.value)}
                        rows={6}
                        className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                        placeholder="#cloud-config&#10;# Leave blank to use the built-in Docker install template"
                      />
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Leave blank to use the built-in template that installs Docker inside the VM.
                      </p>

                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Coding Factory section */}
            <div className="mb-4">
              <div className="flex items-center gap-3 mb-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Coding Factory
                </label>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={factoryEnabled}
                    onChange={(e) => setFactoryEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Run multiple AI agents in parallel — each with a dedicated role and shared workspace.
              </p>

              {factoryEnabled && (
                <div className="border border-gray-200 dark:border-gray-600 rounded p-4 space-y-3">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                    Active Roles
                  </div>
                  <div className="space-y-2">
                    {FACTORY_ROLES.map((role) => (
                      <label
                        key={role}
                        className="flex items-center gap-3 cursor-pointer text-sm text-gray-700 dark:text-gray-300"
                      >
                        <input
                          type="checkbox"
                          checked={factoryRoles.includes(role)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFactoryRoles((prev) => [...prev, role]);
                            } else {
                              setFactoryRoles((prev) => prev.filter((r) => r !== role));
                            }
                          }}
                          className="accent-blue-600"
                        />
                        <span className="font-medium">{FACTORY_ROLE_LABELS[role]}</span>
                        <span className="text-xs text-gray-400">
                          — uses PROMPT_{role}.md if present
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-3">
                    <label htmlFor="feature-requests-content" className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      @feature_requests.md content (optional)
                    </label>
                    <textarea
                      id="feature-requests-content"
                      value={featureRequestsContent}
                      onChange={(e) => setFeatureRequestsContent(e.target.value)}
                      rows={5}
                      placeholder={'# Feature Requests\n\nAdd feature requests here...'}
                      className="w-full px-2 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Pre-populate <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">@feature_requests.md</code> with your requirements. Leave blank to use the default template. The file is never overwritten if it already exists on disk.
                    </p>
                  </div>

                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    Team coordination files (@feature_requests.md, @team_plan.md, team/handovers/*, team/tasks/pending/, tasks/pending/)
                    will be created in the workspace automatically.
                  </p>
                </div>
              )}
            </div>

            {/* Pre-Validation Scripts section */}
            <PreValidationSection
              selected={preValidationScripts}
              onChange={setPreValidationScripts}
            />

            {/* LLM Configs section */}
            <div className="mb-4">
              <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 pb-1 border-b border-gray-200 dark:border-gray-700 mb-3">
                LLM Configs
              </div>
              <div className="space-y-2">
                {/* Claude subsection */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                      Claude
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowClaudeConfig(!showClaudeConfig)}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      {showClaudeConfig ? '▲ Hide' : '▼ Show'}
                    </button>
                  </div>
                  {showClaudeConfig && (
                    <div className="pl-1 mt-2">
                      <HooksSection selected={hooks} onChange={setHooks} />
                      <ClaudeSettingsSection selected={claudeSettingsFile} onChange={setClaudeSettingsFile} />
                    </div>
                  )}
                </div>

                {/* Kiro subsection */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                      Kiro
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowKiroConfig(!showKiroConfig)}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      {showKiroConfig ? '▲ Hide' : '▼ Show'}
                    </button>
                  </div>
                  {showKiroConfig && (
                    <div className="pl-1 mt-2">
                      <KiroHooksSection selected={kiroHooks} onChange={setKiroHooks} />
                      <div className="mb-4">
                        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Kiro Config</div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                          Paste a JSON config to inject into the container at{' '}
                          <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">~/.kiro/config.json</code>.
                          Leave blank to skip.
                        </p>
                        <textarea
                          value={kiroConfig}
                          onChange={(e) => setKiroConfig(e.target.value)}
                          placeholder={'{\n  "model": "...",\n  "apiKey": "..."\n}'}
                          rows={6}
                          className="w-full px-2 py-1 text-sm bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Loop Scripts section */}
            <LoopScriptsSection selected={loopScript} onChange={setLoopScript} />

            {/* GitHub SSH Access section — only shown when repo URL is a GitHub URL */}
            {isGithubRepo && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
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
                  <div className="bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded p-4 space-y-3">
                    <div>
                      <input
                        id="githubPat"
                        type="password"
                        value={githubPat}
                        onChange={(e) => setGithubPat(e.target.value)}
                        placeholder={hasStoredPat ? '••••••••••••  (leave blank to keep existing)' : 'github_pat_…'}
                        className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        autoComplete="off"
                      />
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Fine-grained PAT scoped to this repo with:{' '}
                        <strong className="text-gray-700 dark:text-gray-300">Administration</strong> (read/write) for deploy keys,{' '}
                        <strong className="text-gray-700 dark:text-gray-300">Contents</strong> (read/write) to push commits,{' '}
                        <strong className="text-gray-700 dark:text-gray-300">Actions</strong> (read) to check workflow runs.{' '}
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

            {/* GitLab SSH Access section — only shown when repo URL is a GitLab URL */}
            {isGitlabRepo && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    GitLab SSH Access
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowGitlabSection(!showGitlabSection)}
                    className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    {showGitlabSection ? 'Hide' : hasStoredGitlabPat ? 'Update Token' : 'Set Up'}
                  </button>
                </div>

                {!showGitlabSection && hasStoredGitlabPat && (
                  <p className="text-xs text-green-400">Token stored — deploy keys will be created automatically on loop start.</p>
                )}

                {showGitlabSection && (
                  <div className="bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded p-4 space-y-3">
                    <div>
                      <input
                        id="gitlabPat"
                        type="password"
                        value={gitlabPat}
                        onChange={(e) => setGitlabPat(e.target.value)}
                        placeholder={hasStoredGitlabPat ? '••••••••••••  (leave blank to keep existing)' : 'glpat-…'}
                        className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        autoComplete="off"
                      />
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        PAT with <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">api</code> or <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">write_repository</code> scope for deploy key management.{' '}
                        <a
                          href="https://gitlab.com/-/user_settings/personal_access_tokens"
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 hover:text-blue-300 underline"
                          onClick={(e) => { e.preventDefault(); window.open('https://gitlab.com/-/user_settings/personal_access_tokens', '_blank'); }}
                        >
                          Create token on GitLab
                        </a>
                      </p>
                    </div>

                    {hasStoredGitlabPat && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (mode === 'edit' && project) {
                            await window.api.gitlabPat.delete(project.id);
                            setHasStoredGitlabPat(false);
                            setGitlabPat('');
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
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
                <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                  {Object.keys(customPrompts).length} custom prompt(s) configured
                </div>
              )}

              {showPromptEditor && (
                <PromptEditor prompts={customPrompts} onChange={setCustomPrompts} />
              )}
            </div>

            {/* Spec Files section */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Spec Files
                </label>
                <button
                  type="button"
                  onClick={() => setShowSpecFilesEditor(!showSpecFilesEditor)}
                  className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  {showSpecFilesEditor ? 'Hide' : 'Manage Specs'}
                </button>
              </div>

              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Optional project-specific specification files. Written to{' '}
                <span className="font-mono">/workspace/specs/</span> inside the container.
              </p>

              {Object.keys(specFiles).length > 0 && (
                <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                  {Object.keys(specFiles).length} spec file(s) configured
                </div>
              )}

              {showSpecFilesEditor && (
                <SpecFilesSection specFiles={specFiles} onChange={setSpecFiles} />
              )}
            </div>

            {/* Action buttons */}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
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
