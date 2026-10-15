import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { safeCopyToClipboard } from '../utils/clipboard';

export function getCleanPackName(addon) {
  if (!addon) return 'Bedrock Add-On';
  if (addon.display_name && addon.display_name !== 'pack.name') return addon.display_name;
  if (addon.name && addon.name !== 'pack.name') return addon.name;
  if (addon.original_filename) {
    return addon.original_filename
      .replace(/\.(mcaddon|mcpack|zip)$/i, '')
      .replace(/\s*\((?:addon|bp|rp|behavior|resource|pack)\)\s*/gi, ' ')
      .replace(/\[(?:bp|rp|behavior|resource|pack)\]/gi, ' ')
      .replace(/[_\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return 'Bedrock Add-On';
}

export function getCleanPackDesc(addon) {
  if (!addon) return '';
  const d = addon.description || '';
  if (!d || d === 'pack.description' || d.startsWith('pack.')) {
    return 'Bedrock Dedicated Server modification package.';
  }
  return d;
}

export const Addons = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Engine Modes: 'manage' | 'priorities' | 'diagnostics'
  const [engineMode, setEngineMode] = useState('manage');

  // Installed and active packs state
  const [addonsList, setAddonsList] = useState([]);
  const [activeBP, setActiveBP] = useState([]);
  const [activeRP, setActiveRP] = useState([]);
  const [activeWorldName, setActiveWorldName] = useState('Bedrock level');

  // Loading and feedback states
  const [loading, setLoading] = useState(true);
  const [savingOrder, setSavingOrder] = useState(false);
  const [scanningDisk, setScanningDisk] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Search, filter, and sort states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'active' | 'inactive'
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'behavior' | 'resource'
  const [sortBy, setSortBy] = useState('date'); // 'date' | 'alpha' | 'active_first' | 'inactive_first'
  const [showSystemPacks, setShowSystemPacks] = useState(false); // Hide Mojang/BDS stock system addons by default

  // Upload gateway state
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadQueue, setUploadQueue] = useState([]);
  const fileInputRef = useRef(null);

  // Modals state
  const [editModalAddon, setEditModalAddon] = useState(null);
  const [editForm, setEditForm] = useState({
    displayName: '',
    description: '',
    downloadUrl: '',
    notes: '',
    type: 'behavior',
    syncGroup: true,
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const [inPlaceUpdateAddon, setInPlaceUpdateAddon] = useState(null);
  const [inPlaceFile, setInPlaceFile] = useState(null);
  const [inPlaceUpdating, setInPlaceUpdating] = useState(false);
  const inPlaceInputRef = useRef(null);

  const [deleteModalPack, setDeleteModalPack] = useState(null);
  const [deleteCompanionChoice, setDeleteCompanionChoice] = useState('both'); // 'both' | 'single'
  const [isDeleting, setIsDeleting] = useState(false);

  // Multi-select and batch operations state
  const [selectedUuids, setSelectedUuids] = useState(new Set());
  const [batchDeleteModalOpen, setBatchDeleteModalOpen] = useState(false);
  const [batchIncludeCompanions, setBatchIncludeCompanions] = useState(true);

  const [bulkConfirmAction, setBulkConfirmAction] = useState(null); // 'enable_all' | 'disable_all' | 'delete_all'
  const [bulkProcessing, setBulkProcessing] = useState(false);

  // Drag & drop reordering state (Mode 2)
  const [draggedItem, setDraggedItem] = useState(null); // { index, type: 'bp' | 'rp' }
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // URL Finder Wizard State (for uploaded packs and manual search)
  const [urlWizardOpen, setUrlWizardOpen] = useState(false);
  const [urlWizardQueue, setUrlWizardQueue] = useState([]);
  const [urlWizardIndex, setUrlWizardIndex] = useState(0);
  const [urlWizardQuery, setUrlWizardQuery] = useState('');
  const [urlWizardSearching, setUrlWizardSearching] = useState(false);
  const [urlWizardResults, setUrlWizardResults] = useState([]);
  const [urlWizardCustomUrl, setUrlWizardCustomUrl] = useState('');
  const [urlWizardSaving, setUrlWizardSaving] = useState(false);
  const [urlWizardError, setUrlWizardError] = useState(null);
  const [urlWizardSuccess, setUrlWizardSuccess] = useState(null);
  const [urlWizardAutoSearchingAll, setUrlWizardAutoSearchingAll] = useState(false);

  // Diagnostics Engine state
  const [diagnosticsReport, setDiagnosticsReport] = useState(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [autoFixingId, setAutoFixingId] = useState(null);

  // Suggestions & Swaps state (Mode 3)
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [swappingUuid, setSwappingUuid] = useState(null);
  const [swapConfirmModal, setSwapConfirmModal] = useState(null); // { addon, swapPair }

  // Load swap suggestions from server
  const loadSuggestions = useCallback(async () => {
    setLoadingSuggestions(true);
    try {
      const res = await api.Addons.getSuggestions();
      setSuggestions(res.suggestions || []);
    } catch (err) {
      console.warn('Failed to load swap suggestions:', err.message);
    } finally {
      setLoadingSuggestions(false);
    }
  }, []);

  // Handle swapping pack location between BP and RP (single or dual-pack pair)
  const handleSwapPack = async (addon, swapPair = false) => {
    if (!addon || !isAdmin) return;
    setSwappingUuid(addon.uuid);
    setError(null);
    try {
      const res = await api.Addons.swapPackType(addon.uuid, swapPair);
      setSuccessMsg(res.message || 'Pack type swapped successfully.');
      setSwapConfirmModal(null);
      if (editModalAddon && (editModalAddon.uuid === addon.uuid || (swapPair && editModalAddon.group_id === addon.group_id))) {
        setEditModalAddon(null);
      }
      await loadData();
      await loadSuggestions();
    } catch (err) {
      console.error('Error swapping pack type:', err);
      setError(err.message || 'Failed to swap pack type.');
    } finally {
      setSwappingUuid(null);
    }
  };

  // Load all addons, active order, and suggestions from server
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [installedRes, activeRes, suggestionsRes] = await Promise.allSettled([
        api.Addons.list(),
        api.Addons.getActive(),
        api.Addons.getSuggestions(),
      ]);

      if (installedRes.status === 'fulfilled') {
        const data = installedRes.value;
        const list = Array.isArray(data) ? data : (data?.addons || []);
        setAddonsList(list);
      } else {
        console.error('Failed to list addons:', installedRes.reason);
        setError('Failed to fetch installed addons catalog.');
      }

      if (activeRes.status === 'fulfilled') {
        const activeData = activeRes.value || {};
        if (activeData.worldName) {
          setActiveWorldName(activeData.worldName);
        }
        setActiveBP(activeData.behaviorPacks || []);
        setActiveRP(activeData.resourcePacks || []);
      }

      if (suggestionsRes.status === 'fulfilled') {
        setSuggestions(suggestionsRes.value?.suggestions || []);
      }
    } catch (err) {
      console.error('Error fetching addons data:', err);
      setError(err.message || 'Error communicating with server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Save gemini key to localStorage
  const handleSaveGeminiKey = (key) => {
    setGeminiApiKey(key);
    if (key.trim()) {
      localStorage.setItem('gemini_api_key', key.trim());
    } else {
      localStorage.removeItem('gemini_api_key');
    }
  };

  // Run diagnostics engine
  const runDiagnostics = async () => {
    setLoadingDiagnostics(true);
    try {
      const report = await api.Addons.getDiagnostics(geminiApiKey.trim());
      setDiagnosticsReport(report);
    } catch (err) {
      console.error('Diagnostics failed:', err);
      setError('Diagnostics engine failed: ' + (err.message || 'Unknown error'));
    } finally {
      setLoadingDiagnostics(false);
    }
  };

  useEffect(() => {
    if (engineMode === 'diagnostics' && !diagnosticsReport) {
      runDiagnostics();
    } else if (engineMode === 'suggestions') {
      loadSuggestions();
    }
  }, [engineMode, diagnosticsReport, loadSuggestions]);

  // Disk sync / scan folders
  const handleScanFolders = async () => {
    setScanningDisk(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await api.Addons.scan();
      setSuccessMsg(res.message || `Disk sync completed: ${res.scannedCount} packs inspected.`);
      await loadData();
    } catch (err) {
      console.error('Failed to scan folders:', err);
      setError(err.message || 'Failed to scan disk folders.');
    } finally {
      setScanningDisk(false);
    }
  };

  // Importer Gateway handlers
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDropFile = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) {
      handleFilesSelected(files);
    }
  };

  const handleFileInputChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      handleFilesSelected(files);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFilesSelected = async (files) => {
    const validExtensions = ['.zip', '.mcpack', '.mcaddon', '.mcworld'];
    const validFiles = files.filter((f) => {
      const lower = f.name.toLowerCase();
      return validExtensions.some((ext) => lower.endsWith(ext));
    });

    if (validFiles.length === 0) {
      setError('Invalid file format. Please upload .mcpack, .mcaddon, .mcworld, or .zip packages.');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);
    setSuccessMsg(null);
    setUploadQueue(validFiles.map((f) => f.name));

    let successCount = 0;
    const errors = [];
    const allProcessed = [];

    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      try {
        const res = await api.Addons.upload(file);
        successCount++;
        if (res && res.addons && Array.isArray(res.addons)) {
          allProcessed.push(...res.addons);
        }
      } catch (err) {
        console.error(`Failed to upload ${file.name}:`, err);
        errors.push(`${file.name}: ${err.message || 'Upload failed'}`);
      }
      setUploadProgress(Math.round(((i + 1) / validFiles.length) * 100));
    }

    setIsUploading(false);
    setUploadQueue([]);

    if (errors.length > 0) {
      setError(`Installed ${successCount}/${validFiles.length} pack(s). Errors: ${errors.join(', ')}`);
    } else {
      setSuccessMsg(`Successfully installed ${successCount} addon package(s)! Automatically synchronized to world.`);
    }

    await loadData();
    if (engineMode === 'diagnostics') {
      runDiagnostics();
    }

    // Launch URL Search Wizard for newly added packs
    if (allProcessed.length > 0) {
      const queue = [];
      const seenKeys = new Set();
      for (const addon of allProcessed) {
        const key = addon.groupId || addon.uuid;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          queue.push(addon);
        }
      }
      if (queue.length > 0) {
        startUrlWizard(queue);
      }
    }
  };

  // URL Finder Wizard Methods
  const startUrlWizard = (queue, startIndex = 0) => {
    if (!queue || queue.length === 0) return;
    setUrlWizardQueue(queue);
    setUrlWizardIndex(startIndex);
    setUrlWizardResults([]);
    setUrlWizardCustomUrl('');
    setUrlWizardError(null);
    setUrlWizardSuccess(null);
    setUrlWizardOpen(true);

    const currentItem = queue[startIndex];
    if (currentItem) {
      const rawTitle = (currentItem.displayName && currentItem.displayName !== 'pack.name')
        ? currentItem.displayName
        : (currentItem.name && currentItem.name !== 'pack.name'
            ? currentItem.name
            : (currentItem.originalFilename || ''));
      const q = rawTitle
        .replace(/\.(mcaddon|mcpack|zip)$/i, '')
        .replace(/[\s\-_]*(addon|\(addon\)|pack|\(pack\)|behavior|resource|bp|rp)$/i, '')
        .trim();
      setUrlWizardQuery(q);
      fetchUrlSearchResults(q, currentItem.uuid);
    }
  };

  const fetchUrlSearchResults = async (query, uuid) => {
    if (!query || !query.trim()) return;
    setUrlWizardSearching(true);
    setUrlWizardError(null);
    try {
      const res = await api.Addons.searchUrl(query.trim(), uuid);
      setUrlWizardResults(res.results || []);
      if (!res.results || res.results.length === 0) {
        setUrlWizardError('No matching web pages found. You can try a different search term or paste a custom URL.');
      }
    } catch (err) {
      console.warn('URL search failed:', err);
      setUrlWizardError('Failed to search online. You can enter a custom URL below or skip.');
      setUrlWizardResults([]);
    } finally {
      setUrlWizardSearching(false);
    }
  };

  const handleAssignUrl = async (urlToAssign) => {
    const currentItem = urlWizardQueue[urlWizardIndex];
    if (!currentItem || !urlToAssign) return;

    setUrlWizardSaving(true);
    setUrlWizardError(null);
    try {
      await api.Addons.updateMetadata(currentItem.uuid, {
        download_url: urlToAssign,
        syncGroup: true
      });
      if (editModalAddon && editModalAddon.uuid === currentItem.uuid) {
        setEditForm((prev) => ({ ...prev, downloadUrl: urlToAssign }));
      }
      setUrlWizardSuccess(`Linked URL to "${currentItem.displayName || currentItem.name}"!`);
      await loadData();

      // Advance to next pack or close
      setTimeout(() => {
        handleWizardNext();
      }, 600);
    } catch (err) {
      setUrlWizardError(`Failed to save URL: ${err.message || 'Unknown error'}`);
    } finally {
      setUrlWizardSaving(false);
    }
  };

  const handleWizardNext = () => {
    setUrlWizardSuccess(null);
    setUrlWizardError(null);
    setUrlWizardCustomUrl('');
    const nextIdx = urlWizardIndex + 1;
    if (nextIdx < urlWizardQueue.length) {
      setUrlWizardIndex(nextIdx);
      const nextItem = urlWizardQueue[nextIdx];
      const rawTitle = (nextItem.displayName && nextItem.displayName !== 'pack.name')
        ? nextItem.displayName
        : (nextItem.name && nextItem.name !== 'pack.name'
            ? nextItem.name
            : (nextItem.originalFilename || ''));
      const q = rawTitle
        .replace(/\.(mcaddon|mcpack|zip)$/i, '')
        .replace(/[\s\-_]*(addon|\(addon\)|pack|\(pack\)|behavior|resource|bp|rp)$/i, '')
        .trim();
      setUrlWizardQuery(q);
      fetchUrlSearchResults(q, nextItem.uuid);
    } else {
      setUrlWizardOpen(false);
      setUrlWizardQueue([]);
    }
  };

  const handleWizardSkipPack = () => {
    handleWizardNext();
  };

  const handleWizardSkipAll = () => {
    setUrlWizardOpen(false);
    setUrlWizardQueue([]);
    setUrlWizardResults([]);
  };

  const handleWizardAutoSearchAll = async () => {
    setUrlWizardAutoSearchingAll(true);
    setUrlWizardError(null);
    try {
      for (let i = urlWizardIndex; i < urlWizardQueue.length; i++) {
        const item = urlWizardQueue[i];
        const rawTitle = (item.displayName && item.displayName !== 'pack.name')
          ? item.displayName
          : (item.name && item.name !== 'pack.name'
              ? item.name
              : (item.originalFilename || ''));
        const q = rawTitle
          .replace(/\.(mcaddon|mcpack|zip)$/i, '')
          .replace(/[\s\-_]*(addon|\(addon\)|pack|\(pack\)|behavior|resource|bp|rp)$/i, '')
          .trim();
        try {
          const res = await api.Addons.searchUrl(q, item.uuid);
          if (res.results && res.results.length > 0 && res.results[0].url) {
            await api.Addons.updateMetadata(item.uuid, {
              download_url: res.results[0].url,
              syncGroup: true
            });
          }
        } catch (_) {}
      }
      await loadData();
      setUrlWizardOpen(false);
      setUrlWizardQueue([]);
      setSuccessMsg('Auto-assigned top search URLs to all uploaded addon packages!');
    } catch (err) {
      setUrlWizardError(`Auto-search failed: ${err.message}`);
    } finally {
      setUrlWizardAutoSearchingAll(false);
    }
  };

  // In-place pack update handler
  const handleInPlaceUpdate = async (e) => {
    e.preventDefault();
    if (!inPlaceUpdateAddon || !inPlaceFile) return;

    setInPlaceUpdating(true);
    setError(null);
    setSuccessMsg(null);

    try {
      await api.Addons.updateInPlace(inPlaceUpdateAddon.uuid, inPlaceFile);
      setSuccessMsg(`Pack "${inPlaceUpdateAddon.display_name || inPlaceUpdateAddon.name}" updated in-place successfully.`);
      setInPlaceUpdateAddon(null);
      setInPlaceFile(null);
      await loadData();
    } catch (err) {
      console.error('Failed to update pack in-place:', err);
      setError(err.message || 'Failed to update pack in-place.');
    } finally {
      setInPlaceUpdating(false);
    }
  };

  // Metadata edit handlers
  const openEditModal = (addon) => {
    setEditModalAddon(addon);
    setEditForm({
      displayName: addon.display_name || addon.name || '',
      description: addon.description || '',
      downloadUrl: addon.download_url || '',
      notes: addon.notes || '',
      type: addon.type || 'behavior',
      syncGroup: Boolean(addon.group_id),
    });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editModalAddon) return;

    setSavingEdit(true);
    setError(null);
    setSuccessMsg(null);

    try {
      await api.Addons.updateMetadata(editModalAddon.uuid, editForm);
      setSuccessMsg(`Addon metadata for "${editForm.displayName || editModalAddon.name}" saved successfully.`);
      setEditModalAddon(null);
      await loadData();
    } catch (err) {
      console.error('Failed to update metadata:', err);
      setError(err.message || 'Failed to update addon settings.');
    } finally {
      setSavingEdit(false);
    }
  };

  // Delete pack handler (supports deleting companion dual-pack if requested)
  const handleDeletePack = async (uuid, deleteCompanion = false) => {
    setIsDeleting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await api.Addons.delete(uuid, { deleteCompanion });
      setSuccessMsg(res.message || 'Addon successfully uninstalled from server.');
      setDeleteModalPack(null);
      setSelectedUuids((prev) => {
        const next = new Set(prev);
        next.delete(uuid);
        if (res.deletedUuids) {
          res.deletedUuids.forEach((id) => next.delete(id));
        }
        return next;
      });
      await loadData();
      if (engineMode === 'diagnostics') {
        runDiagnostics();
      }
    } catch (err) {
      console.error('Failed to delete pack:', err);
      setError(err.message || 'Failed to uninstall pack.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Multi-select helpers & batch action handlers
  const toggleSelect = (uuid) => {
    setSelectedUuids((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) {
        next.delete(uuid);
      } else {
        next.add(uuid);
      }
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    const selectable = displayedAddons.filter((a) => !a.is_system);
    if (selectable.length > 0 && selectable.every((a) => selectedUuids.has(a.uuid))) {
      // Deselect all
      setSelectedUuids(new Set());
    } else {
      setSelectedUuids(new Set(selectable.map((a) => a.uuid)));
    }
  };

  const clearSelection = () => {
    setSelectedUuids(new Set());
  };

  const handleExecuteBatch = async (action, includeCompanions = true) => {
    if (selectedUuids.size === 0) return;

    setBulkProcessing(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const uuidsArr = Array.from(selectedUuids);
      const res = await api.Addons.bulkAction(action, uuidsArr, { includeCompanions });
      setSuccessMsg(res.message || `Batch ${action} completed successfully.`);
      setSelectedUuids(new Set());
      setBatchDeleteModalOpen(false);
      await loadData();
      if (engineMode === 'diagnostics') {
        runDiagnostics();
      }
    } catch (err) {
      console.error('Batch operation failed:', err);
      setError(err.message || 'Batch operation failed.');
    } finally {
      setBulkProcessing(false);
    }
  };

  // Bulk operations handler
  const handleExecuteBulk = async () => {
    if (!bulkConfirmAction) return;

    setBulkProcessing(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await api.Addons.bulkAction(bulkConfirmAction);
      setSuccessMsg(res.message || `Bulk operation "${bulkConfirmAction}" completed successfully.`);
      setBulkConfirmAction(null);
      await loadData();
      if (engineMode === 'diagnostics') {
        runDiagnostics();
      }
    } catch (err) {
      console.error('Bulk operation failed:', err);
      setError(err.message || 'Bulk operation failed.');
    } finally {
      setBulkProcessing(false);
    }
  };

  // Auto-Fix handler
  const handleAutoFix = async (action, targetUuid) => {
    setAutoFixingId(targetUuid);
    try {
      const res = await api.Addons.autoFix(action, targetUuid);
      setSuccessMsg(res.message || 'Issue resolved automatically.');
      await loadData();
      await runDiagnostics();
    } catch (err) {
      console.error('Auto-fix failed:', err);
      setError('Auto-fix failed: ' + (err.message || 'Unknown error'));
    } finally {
      setAutoFixingId(null);
    }
  };

  // Toggle active status for single pack (or synced dual-pack)
  const handleTogglePack = async (addon) => {
    if (!isAdmin) return;
    const isResource = addon.type === 'resource';
    const activeList = isResource ? activeRP : activeBP;
    const isCurrentlyActive = activeList.some((p) => p.uuid === addon.uuid);

    let companion = null;
    if (addon.group_id) {
      companion = addonsList.find((a) => a.group_id === addon.group_id && a.uuid !== addon.uuid);
    }

    let newBP = [...activeBP];
    let newRP = [...activeRP];

    const formatPack = (a) => {
      const v = typeof a.version === 'string'
        ? a.version.split('.').map((n) => parseInt(n, 10) || 0)
        : (Array.isArray(a.version) ? a.version : [1, 0, 0]);
      return { uuid: a.uuid, version: v, name: a.display_name || a.name };
    };

    if (isCurrentlyActive) {
      // Deactivate pack
      if (isResource) {
        newRP = newRP.filter((p) => p.uuid !== addon.uuid);
      } else {
        newBP = newBP.filter((p) => p.uuid !== addon.uuid);
      }

      // If companion dual-pack, deactivate companion too!
      if (companion) {
        if (companion.type === 'resource') {
          newRP = newRP.filter((p) => p.uuid !== companion.uuid);
        } else {
          newBP = newBP.filter((p) => p.uuid !== companion.uuid);
        }
      }
    } else {
      // Activate pack
      if (isResource) {
        if (!newRP.some((p) => p.uuid === addon.uuid)) {
          newRP.push(formatPack(addon));
        }
      } else {
        if (!newBP.some((p) => p.uuid === addon.uuid)) {
          newBP.push(formatPack(addon));
        }
      }

      // If companion dual-pack, activate companion too!
      if (companion) {
        if (companion.type === 'resource') {
          if (!newRP.some((p) => p.uuid === companion.uuid)) {
            newRP.push(formatPack(companion));
          }
        } else {
          if (!newBP.some((p) => p.uuid === companion.uuid)) {
            newBP.push(formatPack(companion));
          }
        }
      }
    }

    setActiveBP(newBP);
    setActiveRP(newRP);

    try {
      await api.Addons.setActive(newBP, newRP);
      setSuccessMsg(
        isCurrentlyActive
          ? `Deactivated "${addon.display_name || addon.name}"${companion ? ' and companion pack' : ''}.`
          : `Activated "${addon.display_name || addon.name}"${companion ? ' and companion pack' : ''} in world.`
      );
      await loadData();
    } catch (err) {
      console.error('Failed to sync pack toggle:', err);
      setError('Failed to update world configuration: ' + err.message);
      await loadData();
    }
  };

  // Priorities Mode (Mode 2) reordering handlers
  const moveActivePack = (type, fromIndex, toIndex, displayedList = null) => {
    const fullList = type === 'bp' ? [...activeBP] : [...activeRP];
    const list = displayedList ? [...displayedList] : fullList;
    if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) return;

    const targetItem = list[fromIndex];
    const destItem = list[toIndex];
    if (!targetItem || !destItem) return;

    const realFromIndex = fullList.findIndex((p) => p.uuid === targetItem.uuid);
    const realToIndex = fullList.findIndex((p) => p.uuid === destItem.uuid);
    if (realFromIndex === -1 || realToIndex === -1) return;

    const [moved] = fullList.splice(realFromIndex, 1);
    fullList.splice(realToIndex, 0, moved);
    if (type === 'bp') {
      setActiveBP(fullList);
    } else {
      setActiveRP(fullList);
    }
  };

  const handleItemDragStart = (e, index, type) => {
    setDraggedItem({ index, type });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleItemDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleItemDrop = (e, targetIndex, type) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.type !== type) {
      setDraggedItem(null);
      setDragOverIndex(null);
      return;
    }
    const sourceIndex = draggedItem.index;
    if (sourceIndex !== targetIndex) {
      const displayedList = type === 'bp' ? displayedActiveBP : displayedActiveRP;
      moveActivePack(type, sourceIndex, targetIndex, displayedList);
    }
    setDraggedItem(null);
    setDragOverIndex(null);
  };

  const handleItemDragEnd = () => {
    setDraggedItem(null);
    setDragOverIndex(null);
  };

  const handleSaveOrder = async () => {
    setSavingOrder(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.Addons.setActive(activeBP, activeRP);
      setSuccessMsg('Active load orders committed to world_behavior_packs.json & world_resource_packs.json!');
    } catch (err) {
      console.error('Failed to save order:', err);
      setError(err.message || 'Failed to save load priorities.');
    } finally {
      setSavingOrder(false);
    }
  };

  // Helper metrics
  const activeBPUuids = useMemo(() => new Set(activeBP.map((p) => p.uuid)), [activeBP]);
  const activeRPUuids = useMemo(() => new Set(activeRP.map((p) => p.uuid)), [activeRP]);

  const isPackActive = useCallback(
    (addon) => (addon.type === 'resource' ? activeRPUuids.has(addon.uuid) : activeBPUuids.has(addon.uuid)),
    [activeBPUuids, activeRPUuids]
  );

  const customPacks = useMemo(() => addonsList.filter((a) => !a.is_system), [addonsList]);
  const systemPacks = useMemo(() => addonsList.filter((a) => a.is_system), [addonsList]);

  const currentPool = showSystemPacks ? addonsList : customPacks;
  const totalInstalled = currentPool.length;
  const totalBP = useMemo(() => currentPool.filter((a) => a.type === 'behavior').length, [currentPool]);
  const totalRP = useMemo(() => currentPool.filter((a) => a.type === 'resource').length, [currentPool]);
  const totalActive = useMemo(
    () => currentPool.filter((a) => isPackActive(a)).length,
    [currentPool, isPackActive]
  );
  const activeRatio = totalInstalled > 0 ? Math.round((totalActive / totalInstalled) * 100) : 0;

  // Filtered & sorted addons list for Mode 1
  const displayedAddons = useMemo(() => {
    let result = [...addonsList];

    // Filter out internal system addons unless explicitly enabled
    if (!showSystemPacks) {
      result = result.filter((a) => !a.is_system);
    }

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (a) =>
          (a.display_name && a.display_name.toLowerCase().includes(q)) ||
          (a.name && a.name.toLowerCase().includes(q)) ||
          (a.description && a.description.toLowerCase().includes(q)) ||
          (a.original_filename && a.original_filename.toLowerCase().includes(q)) ||
          (a.uuid && a.uuid.toLowerCase().includes(q))
      );
    }

    // Category / type filter
    if (typeFilter !== 'all') {
      result = result.filter((a) => a.type === typeFilter);
    }

    // Status filter
    if (statusFilter === 'active') {
      result = result.filter((a) => isPackActive(a));
    } else if (statusFilter === 'inactive') {
      result = result.filter((a) => !isPackActive(a));
    }

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'alpha') {
        const nameA = (a.display_name || a.name || '').toLowerCase();
        const nameB = (b.display_name || b.name || '').toLowerCase();
        return nameA.localeCompare(nameB);
      }
      if (sortBy === 'active_first') {
        const actA = isPackActive(a) ? 1 : 0;
        const actB = isPackActive(b) ? 1 : 0;
        return actB - actA;
      }
      if (sortBy === 'inactive_first') {
        const actA = isPackActive(a) ? 1 : 0;
        const actB = isPackActive(b) ? 1 : 0;
        return actA - actB;
      }
      // Default: date newest first
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });

    return result;
  }, [addonsList, showSystemPacks, searchQuery, typeFilter, statusFilter, sortBy, isPackActive]);

  // Mode 2 active and inactive queues
  const systemUuidsSet = useMemo(() => new Set(systemPacks.map((p) => p.uuid)), [systemPacks]);

  const displayedActiveBP = useMemo(() => {
    if (showSystemPacks) return activeBP;
    return activeBP.filter((p) => !systemUuidsSet.has(p.uuid));
  }, [activeBP, systemUuidsSet, showSystemPacks]);

  const displayedActiveRP = useMemo(() => {
    if (showSystemPacks) return activeRP;
    return activeRP.filter((p) => !systemUuidsSet.has(p.uuid));
  }, [activeRP, systemUuidsSet, showSystemPacks]);

  const inactiveBP = useMemo(
    () => currentPool.filter((a) => a.type === 'behavior' && !activeBPUuids.has(a.uuid)),
    [currentPool, activeBPUuids]
  );
  const inactiveRP = useMemo(
    () => currentPool.filter((a) => a.type === 'resource' && !activeRPUuids.has(a.uuid)),
    [currentPool, activeRPUuids]
  );

  return (
    <div className="page-container addons-engine-page">
      {/* Toast Alert */}
      {error && (
        <div className="toast-banner toast-error mb-4">
          <span className="toast-icon">⚠️</span>
          <span>{error}</span>
          <button className="toast-close" onClick={() => setError(null)}>✕</button>
        </div>
      )}
      {successMsg && (
        <div className="toast-banner toast-success mb-4">
          <span className="toast-icon">✓</span>
          <span>{successMsg}</span>
          <button className="toast-close" onClick={() => setSuccessMsg(null)}>✕</button>
        </div>
      )}

      {/* Main Header */}
      <div className="section-header-modern mb-5">
        <div>
          <div className="d-flex items-center gap-3">
            <h1 className="page-title m-0">Addons &amp; Pack Engine</h1>
            <span className={`badge ${isAdmin ? 'badge-success' : 'badge-primary'}`}>
              {isAdmin ? '🛡️ Admin Privilege' : '👁️ View-Only'}
            </span>
          </div>
          <p className="page-subtitle mt-1">
            Manage Minecraft Bedrock modifications, entity behaviors, textures, load priorities, and AI diagnostics.
          </p>
        </div>
        <div className="d-flex gap-2 flex-wrap items-center">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleScanFolders}
            disabled={scanningDisk || loading}
            title="Scan behavior_packs/ and resource_packs/ for packs copied via SFTP/manual copy"
          >
            {scanningDisk ? '🔄 Scanning...' : '📁 Scan Folders'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={loadData}
            disabled={loading}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* METRICS DASHBOARD */}
      <div className="addons-metrics-row mb-5">
        <div className="metric-glass-card">
          <div className="metric-icon">📦</div>
          <div className="metric-info">
            <span className="metric-label">{showSystemPacks ? 'ALL INSTALLED PACKS' : 'CUSTOM ADDONS'}</span>
            <div className="d-flex items-baseline gap-2">
              <span className="metric-val">{totalInstalled}</span>
              <div className="d-flex gap-1.5 items-center flex-wrap">
                <span className="badge badge-behavior text-xs">{totalBP} BP</span>
                <span className="badge badge-resource text-xs">{totalRP} RP</span>
                {!showSystemPacks && systemPacks.length > 0 && (
                  <span
                    className="badge badge-system text-xs"
                    onClick={() => setShowSystemPacks(true)}
                    title="Click to view hidden internal server system addons"
                    style={{ cursor: 'pointer' }}
                  >
                    ⚙️ {systemPacks.length} System Hidden
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="metric-glass-card">
          <div className="metric-icon">⚡</div>
          <div className="metric-info flex-1">
            <div className="d-flex justify-between items-center mb-1">
              <span className="metric-label">PACK STATUS ENGINE</span>
              <span className="text-xs text-white font-mono font-bold">
                {totalActive} / {totalInstalled} Active ({activeRatio}%)
              </span>
            </div>
            <div className="metric-progress-bg">
              <div
                className="metric-progress-fill"
                style={{
                  width: `${activeRatio}%`,
                  background: 'linear-gradient(90deg, #10b981 0%, #06b6d4 100%)',
                }}
              />
            </div>
          </div>
        </div>

        <div className="metric-glass-card">
          <div className="metric-icon">🗺️</div>
          <div className="metric-info">
            <span className="metric-label">ACTIVE WORLD TARGET</span>
            <span className="metric-val font-mono text-base font-bold text-white truncate" title={activeWorldName}>
              {activeWorldName}
            </span>
          </div>
        </div>
      </div>

      {/* ENGINE MODE NAVIGATION TABS */}
      <div className="settings-nav-tabs mb-5">
        <button
          type="button"
          className={`settings-tab-btn ${engineMode === 'manage' ? 'active' : ''}`}
          onClick={() => setEngineMode('manage')}
        >
          <span className="tab-icon">🗂️</span>
          <span>Mode 1: Manage Packs ({totalInstalled})</span>
        </button>
        <button
          type="button"
          className={`settings-tab-btn ${engineMode === 'priorities' ? 'active' : ''}`}
          onClick={() => setEngineMode('priorities')}
        >
          <span className="tab-icon">⚖️</span>
          <span>Mode 2: Load Priorities ({displayedActiveBP.length + displayedActiveRP.length})</span>
        </button>
        <button
          type="button"
          className={`settings-tab-btn ${engineMode === 'suggestions' ? 'active' : ''}`}
          onClick={() => {
            setEngineMode('suggestions');
            loadSuggestions();
          }}
        >
          <span className="tab-icon">💡</span>
          <span className="d-flex items-center gap-1.5">
            <span>Mode 3: Suggestions &amp; Swaps</span>
            {suggestions.length > 0 && (
              <span className="badge badge-warning text-xs font-bold py-0.5 px-1.5">
                {suggestions.length}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          className={`settings-tab-btn ${engineMode === 'diagnostics' ? 'active' : ''}`}
          onClick={() => setEngineMode('diagnostics')}
        >
          <span className="tab-icon">🩺</span>
          <span>Mode 4: AI Diagnostics Engine</span>
        </button>
      </div>

      {/* =========================================================================
          MODE 1: MANAGE PACKS (GRID VIEW)
          ========================================================================= */}
      {engineMode === 'manage' && (
        <div className="engine-mode-content">
          {/* IMPORTER GATEWAY (DRAG & DROP + NATIVE BROWSER) */}
          <div className="modern-card mb-5">
            <div
              className={`upload-zone-modern ${isDraggingFile ? 'dragging' : ''} ${isUploading ? 'uploading' : ''}`}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDropFile}
              onClick={() => !isUploading && isAdmin && fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                className="d-none"
                multiple
                accept=".mcpack,.mcaddon,.mcworld,.zip"
                onChange={handleFileInputChange}
                disabled={isUploading || !isAdmin}
              />

              <div className="upload-zone-inner p-6 text-center">
                <div className="upload-animated-icon mb-3">📥</div>
                <h3 className="upload-main-title mb-1">
                  {isDraggingFile ? 'Drop Addon Packages Here' : 'Importer Gateway: Drag & Drop Bedrock Addons'}
                </h3>
                <p className="upload-sub-desc text-muted mb-4">
                  Supports <code>.mcpack</code>, <code>.mcaddon</code> (paired dual-packs), <code>.mcworld</code> (map bundles), and <code>.zip</code>.
                </p>

                <div className="d-flex justify-center gap-3">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={isUploading || !isAdmin}
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    📁 Select Addon Files
                  </button>
                </div>

                {!isAdmin && (
                  <p className="text-warning text-xs mt-3 mb-0">
                    * Administrator credentials required to upload server addons.
                  </p>
                )}
              </div>

              {isUploading && (
                <div className="upload-progress-box px-6 pb-6">
                  <div className="d-flex justify-between text-xs text-sub mb-2 font-mono">
                    <span>Installing {uploadQueue.length} package(s)...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="metric-progress-bg">
                    <div
                      className="metric-progress-fill"
                      style={{
                        width: `${uploadProgress}%`,
                        background: 'linear-gradient(90deg, #3b82f6 0%, #10b981 100%)',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* SEARCH, SORTING & BULK CONTROLS BAR */}
          <div className="addon-controls-bar mb-4 p-4 rounded-xl modern-card">
            <div className="d-flex justify-between items-center flex-wrap gap-3">
              {/* Search input */}
              <div className="search-input-wrap flex-1 min-w-260">
                <span className="search-icon">🔍</span>
                <input
                  type="text"
                  className="input-modern w-full"
                  placeholder="Search packs by title, description, or filename..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Filters & Sorting */}
              <div className="d-flex items-center gap-2 flex-wrap">
                {/* Category Type Filter */}
                <select
                  className="input-modern select-modern"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                >
                  <option value="all">All Categories</option>
                  <option value="behavior">Behavior Packs (BP)</option>
                  <option value="resource">Resource Packs (RP)</option>
                </select>

                {/* Status Filter */}
                <select
                  className="input-modern select-modern"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active Only</option>
                  <option value="inactive">Inactive Only</option>
                </select>

                {/* Sort By */}
                <select
                  className="input-modern select-modern"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                >
                  <option value="date">Newest Installed</option>
                  <option value="alpha">Alphabetical (A-Z)</option>
                  <option value="active_first">Active First</option>
                  <option value="inactive_first">Inactive First</option>
                </select>

                {/* Show/Hide System Addons Toggle */}
                <button
                  type="button"
                  className={`btn btn-sm ${showSystemPacks ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setShowSystemPacks((prev) => !prev)}
                  title={showSystemPacks ? 'Click to hide stock BDS system addons' : 'Click to show internal BDS system addons (vanilla/chemistry/editor)'}
                >
                  ⚙️ {showSystemPacks ? 'Hide System Addons' : `Show System Addons (${systemPacks.length})`}
                </button>

                {/* Multi-Select Select All / Clear Button */}
                {isAdmin && (
                  <button
                    type="button"
                    className={`btn btn-sm ${selectedUuids.size > 0 ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={handleSelectAllFiltered}
                    title="Select or deselect all visible custom packs for batch operations"
                  >
                    {selectedUuids.size > 0 ? `☑️ Clear Selection (${selectedUuids.size})` : '☑️ Select Multiple'}
                  </button>
                )}

                {/* Bulk Actions Dropdown */}
                {isAdmin && (
                  <div className="dropdown-wrapper">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setBulkConfirmAction(bulkConfirmAction ? null : 'menu')}
                    >
                      ⚙️ Bulk Actions ▼
                    </button>
                    {bulkConfirmAction === 'menu' && (
                      <div className="bulk-menu-popover">
                        <button
                          type="button"
                          className="bulk-menu-item text-success"
                          onClick={() => setBulkConfirmAction('enable_all')}
                        >
                          ✓ Enable All Packs
                        </button>
                        <button
                          type="button"
                          className="bulk-menu-item text-warning"
                          onClick={() => setBulkConfirmAction('disable_all')}
                        >
                          ○ Disable All Packs
                        </button>
                        <div className="menu-divider" />
                        <button
                          type="button"
                          className="bulk-menu-item text-danger"
                          onClick={() => setBulkConfirmAction('delete_all')}
                        >
                          🗑️ Delete All Packs
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* MULTI-SELECT BATCH ACTION TOOLBAR */}
          {selectedUuids.size > 0 && (
            <div className="batch-selection-toolbar mb-4 p-3 px-4 rounded-xl modern-card d-flex justify-between items-center flex-wrap gap-3">
              <div className="d-flex items-center gap-2 flex-wrap">
                <span className="badge badge-primary font-bold text-sm px-3 py-1.5">
                  ☑️ {selectedUuids.size} Pack(s) Selected
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={handleSelectAllFiltered}
                >
                  {selectedUuids.size === displayedAddons.filter((a) => !a.is_system).length ? 'Deselect All' : 'Select All Filtered'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={clearSelection}
                >
                  Clear
                </button>
              </div>

              {isAdmin && (
                <div className="d-flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="btn btn-success btn-sm font-bold"
                    onClick={() => handleExecuteBatch('enable_selected', true)}
                    disabled={bulkProcessing}
                    title="Activate all selected packs in the active world"
                  >
                    {bulkProcessing ? 'Working...' : `● Enable Selected (${selectedUuids.size})`}
                  </button>
                  <button
                    type="button"
                    className="btn btn-warning btn-sm font-bold"
                    onClick={() => handleExecuteBatch('disable_selected', true)}
                    disabled={bulkProcessing}
                    title="Deactivate all selected packs from the active world"
                  >
                    {bulkProcessing ? 'Working...' : `○ Disable Selected (${selectedUuids.size})`}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm font-bold"
                    onClick={() => setBatchDeleteModalOpen(true)}
                    disabled={bulkProcessing}
                    title="Uninstall and remove all selected packs from server"
                  >
                    🗑️ Delete Selected ({selectedUuids.size})
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ADDON CARDS GRID */}
          {displayedAddons.length === 0 ? (
            <div className="empty-state-card text-center p-8 modern-card">
              <div className="empty-glyph mb-3">📦</div>
              <h3 className="empty-title mb-1">No Addon Packs Found</h3>
              <p className="text-sub text-sm mb-4">
                {searchQuery || typeFilter !== 'all' || statusFilter !== 'all'
                  ? 'No packs matched your search query or filters. Try resetting filters.'
                  : 'No behavior or resource packs are currently installed on this server. Drag and drop a .mcpack, .mcaddon, or .mcworld above to get started!'}
              </p>
              {(searchQuery || typeFilter !== 'all' || statusFilter !== 'all') && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setSearchQuery('');
                    setTypeFilter('all');
                    setStatusFilter('all');
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <div className="addon-grid-modern">
              {displayedAddons.map((addon) => {
                const active = isPackActive(addon);
                const isBP = addon.type === 'behavior';
                const hasCompanion = Boolean(addon.group_id);
                const isSelected = selectedUuids.has(addon.uuid);

                return (
                  <div
                    key={addon.uuid}
                    className={`modern-addon-card ${active ? 'is-active' : 'is-inactive'} ${isBP ? 'type-bp' : 'type-rp'} ${isSelected ? 'is-selected' : ''}`}
                  >
                    {/* Card Top: Checkbox, Icon, Badges, Ping Indicator */}
                    <div className="addon-card-top mb-3">
                      <div className="d-flex items-center gap-2">
                        {/* Multi-Select Checkbox */}
                        {isAdmin && !addon.is_system && (
                          <label
                            className="addon-card-checkbox-wrap"
                            onClick={(e) => e.stopPropagation()}
                            title={isSelected ? 'Deselect pack' : 'Select pack for batch action'}
                          >
                            <input
                              type="checkbox"
                              className="addon-card-checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(addon.uuid)}
                            />
                          </label>
                        )}

                        <div className="addon-icon-wrap">
                          {addon.hasIcon ? (
                            <img
                              src={`/api/addons/${addon.uuid}/icon`}
                              alt={addon.name}
                              className="addon-icon-img"
                              onError={(e) => {
                                e.target.style.display = 'none';
                              }}
                            />
                          ) : (
                            <span className="addon-icon-fallback">
                              {isBP ? '⚙️' : '🎨'}
                            </span>
                          )}
                          <span
                            className={`addon-status-dot ${active ? 'active-pulse' : 'inactive-dot'}`}
                            title={active ? 'Active in current world' : 'Inactive'}
                          />
                        </div>
                      </div>

                      <div className="addon-badges-group">
                        <span className={`badge ${isBP ? 'badge-behavior' : 'badge-resource'}`}>
                          {isBP ? 'Behavior BP' : 'Resource RP'}
                        </span>
                        {addon.is_system && (
                          <span className="badge badge-system" title="Internal Bedrock Dedicated Server addon provided with server hosting">
                            ⚙️ System Addon
                          </span>
                        )}
                        {hasCompanion && (
                          <span className="badge badge-dual-pack" title="Paired dual-pack imported together">
                            🔗 Dual-Pack
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Card Title & Version */}
                    <div
                      className="addon-title-strip mb-2"
                      onClick={() => openEditModal(addon)}
                      style={{ cursor: 'pointer' }}
                      title="Click to view details and swap pack location"
                    >
                      <h3 className="addon-main-title">
                        {getCleanPackName(addon)}
                      </h3>
                      <div className="d-flex items-center gap-2 text-xs text-sub mt-0.5">
                        <span className="font-mono text-emerald font-bold">v{addon.version}</span>
                        {addon.original_filename && (
                          <span className="text-muted font-mono truncate" title={addon.original_filename}>
                            • {addon.original_filename}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Description */}
                    <p className="addon-card-desc text-sub text-xs mb-4">
                      {getCleanPackDesc(addon)}
                    </p>

                    {/* Metadata strip: UUID & Download link */}
                    <div className="addon-details-strip p-2.5 rounded bg-darker mb-4">
                      <div className="d-flex justify-between items-center text-xs mb-1">
                        <span className="text-muted">UUID:</span>
                        <span
                          className="font-mono text-white text-xs clickable-copy"
                          title="Click to copy UUID"
                          onClick={async () => {
                            await safeCopyToClipboard(addon.uuid);
                            setSuccessMsg(`Copied UUID "${addon.uuid}" to clipboard!`);
                          }}
                        >
                          {addon.uuid.substring(0, 8)}...{addon.uuid.substring(addon.uuid.length - 4)} 📋
                        </span>
                      </div>
                      {addon.download_url && (
                        <div className="d-flex justify-between items-center text-xs mt-1">
                          <span className="text-muted">Source:</span>
                          <a
                            href={addon.download_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary font-bold text-xs"
                          >
                            Download Link ↗
                          </a>
                        </div>
                      )}
                    </div>

                    {/* Card Action Controls */}
                    <div className="addon-card-actions mt-auto d-flex justify-between items-center gap-2">
                      {/* Enable / Disable toggle */}
                      <button
                        type="button"
                        className={`btn btn-sm flex-1 ${active ? 'btn-secondary' : 'btn-primary'}`}
                        onClick={() => handleTogglePack(addon)}
                        disabled={!isAdmin}
                        title={
                          !isAdmin
                            ? 'Admin role required'
                            : active
                            ? hasCompanion
                              ? 'Deactivate this pack and companion'
                              : 'Deactivate pack'
                            : hasCompanion
                            ? 'Activate this pack and companion'
                            : 'Activate pack in world'
                        }
                      >
                        {active ? '○ Disable' : '● Enable'}
                      </button>

                      {/* Edit Metadata Modal */}
                      {isAdmin && (
                        <button
                          type="button"
                          className="btn-icon-modern"
                          onClick={() => openEditModal(addon)}
                          title="Edit metadata & settings (Pencil)"
                        >
                          ✏️
                        </button>
                      )}

                      {/* Swap Pack Type (BP ⇄ RP) */}
                      {isAdmin && !addon.is_system && (
                        <button
                          type="button"
                          className="btn-icon-modern"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSwapConfirmModal({ addon, swapPair: hasCompanion });
                          }}
                          disabled={swappingUuid === addon.uuid}
                          title={
                            hasCompanion
                              ? 'Swap dual-pack locations (Invert BP ⇄ RP)'
                              : `Swap to ${addon.type === 'behavior' ? 'Resource Pack' : 'Behavior Pack'} (BP ⇄ RP)`
                          }
                        >
                          {swappingUuid === addon.uuid ? '⏳' : '🔄'}
                        </button>
                      )}

                      {/* In-place Update Modal */}
                      {isAdmin && (
                        <button
                          type="button"
                          className="btn-icon-modern"
                          onClick={() => {
                            setInPlaceUpdateAddon(addon);
                            setInPlaceFile(null);
                          }}
                          disabled={addon.is_system}
                          title={addon.is_system ? 'System packs cannot be updated in-place' : 'In-Place Update (Upload Cloud)'}
                        >
                          ☁️
                        </button>
                      )}

                      {/* Delete Pack */}
                      {isAdmin && (
                        <button
                          type="button"
                          className="btn-icon-modern btn-icon-danger"
                          onClick={() => {
                            setDeleteModalPack(addon);
                            setDeleteCompanionChoice('both');
                          }}
                          disabled={addon.is_system}
                          title={addon.is_system ? 'Internal server system addons cannot be uninstalled' : 'Uninstall pack (Trash)'}
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          MODE 2: LOAD PRIORITIES (ORDER VIEW)
          ========================================================================= */}
      {engineMode === 'priorities' && (
        <div className="engine-mode-content">
          <div className="modern-card p-4 mb-4 d-flex justify-between items-center flex-wrap gap-3">
            <div>
              <h3 className="section-title text-base m-0 d-flex items-center gap-2">
                <span>⚖️</span>
                <span>Active Pack Load Hierarchy</span>
              </h3>
              <p className="text-sub text-xs m-0 mt-1">
                Minecraft Bedrock registers packs sequentially. <strong>Position #1</strong> loads first; packs loaded later override earlier ones if conflicting assets exist.
              </p>
            </div>
            <div className="d-flex gap-2 items-center flex-wrap">
              <button
                type="button"
                className={`btn btn-sm ${showSystemPacks ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setShowSystemPacks((prev) => !prev)}
                title="Toggle display of internal server engine packs in the load hierarchy"
              >
                ⚙️ {showSystemPacks ? 'Hide System Packs' : `Show System Packs (${systemPacks.length})`}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={loadData}
                disabled={savingOrder}
              >
                ↺ Reset Order
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleSaveOrder}
                disabled={savingOrder || !isAdmin}
              >
                {savingOrder ? '💾 Committing...' : '💾 Save Priorities'}
              </button>
            </div>
          </div>

          <div className="two-column gap-6">
            {/* COLUMN 1: ACTIVE BEHAVIOR PACKS */}
            <div className="pack-order-column modern-card p-4">
              <div className="column-header mb-3 pb-3 border-bottom d-flex justify-between items-center">
                <div>
                  <h3 className="section-title text-base m-0 d-flex items-center gap-2">
                    <span className="badge badge-behavior">Behavior Packs</span>
                    <span>Active Queue ({displayedActiveBP.length})</span>
                  </h3>
                  <p className="text-muted text-xs m-0 mt-0.5">Drag grip handles or use arrows to rearrange.</p>
                </div>
              </div>

              <div className="pack-reorder-list mb-4">
                {displayedActiveBP.length === 0 ? (
                  <div className="empty-state py-6 border-dashed rounded text-center text-muted text-sm">
                    No active behavior packs. Click any pack below to activate.
                  </div>
                ) : (
                  displayedActiveBP.map((pack, idx) => {
                    const isDraggingThis = draggedItem?.type === 'bp' && draggedItem?.index === idx;
                    const isDropTarget = dragOverIndex === idx && draggedItem?.type === 'bp';
                    const isSystem = systemUuidsSet.has(pack.uuid);
                    const dbAddon = addonsList.find((a) => a.uuid === pack.uuid);
                    const cleanTitle = dbAddon ? getCleanPackName(dbAddon) : (pack.name && pack.name !== 'pack.name' ? pack.name : 'Bedrock Pack');
                    const companion = dbAddon?.group_id ? addonsList.find(a => a.group_id === dbAddon.group_id && a.uuid !== dbAddon.uuid) : null;
                    const hasIcon = Boolean(dbAddon?.hasIcon || companion?.hasIcon);
                    const iconUuid = (dbAddon?.hasIcon && dbAddon.uuid) || (companion?.hasIcon && companion.uuid) || pack.uuid;

                    return (
                      <div
                        key={pack.uuid || idx}
                        draggable={isAdmin}
                        onDragStart={(e) => handleItemDragStart(e, idx, 'bp')}
                        onDragOver={(e) => handleItemDragOver(e, idx)}
                        onDrop={(e) => handleItemDrop(e, idx, 'bp')}
                        onDragEnd={handleItemDragEnd}
                        className={`pack-item-modern ${isDraggingThis ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}`}
                      >
                        <div className="pack-drag-handle" title="Drag to reorder">
                          ⋮⋮
                        </div>
                        <div className="pack-order-badge">#{idx + 1}</div>

                        {/* Pack Logo / Icon */}
                        <div className="pack-item-icon-wrap" title={cleanTitle}>
                          {hasIcon ? (
                            <img
                              src={`/api/addons/${iconUuid}/icon`}
                              alt=""
                              className="pack-item-icon-img"
                              onError={(e) => {
                                e.target.style.display = 'none';
                                const fallback = e.target.parentElement.querySelector('.pack-item-icon-fallback');
                                if (fallback) fallback.style.display = 'flex';
                              }}
                            />
                          ) : null}
                          <span
                            className="pack-item-icon-fallback"
                            style={{ display: hasIcon ? 'none' : 'flex' }}
                          >
                            ⚙️
                          </span>
                        </div>

                        <div className="pack-info flex-1 min-w-0">
                          <div className="d-flex items-center gap-2">
                            <span className="pack-item-name font-bold text-white truncate">{cleanTitle}</span>
                            {isSystem && (
                              <span className="badge badge-system text-xs py-0 px-1">⚙️ System</span>
                            )}
                          </div>
                          <div className="pack-item-meta text-xs text-muted font-mono">
                            v{pack.version} • {pack.uuid.substring(0, 8)}...
                          </div>
                        </div>

                        {isAdmin && (
                          <div className="pack-order-controls d-flex items-center gap-1">
                            <button
                              type="button"
                              className="btn-order-arrow"
                              onClick={() => moveActivePack('bp', idx, idx - 1, displayedActiveBP)}
                              disabled={idx === 0}
                              title="Move Up"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              className="btn-order-arrow"
                              onClick={() => moveActivePack('bp', idx, idx + 1, displayedActiveBP)}
                              disabled={idx === displayedActiveBP.length - 1}
                              title="Move Down"
                            >
                              ▼
                            </button>
                            <button
                              type="button"
                              className="btn-order-remove"
                              onClick={() => {
                                const newBP = activeBP.filter((p) => p.uuid !== pack.uuid);
                                setActiveBP(newBP);
                              }}
                              title="Remove from active"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Inactive Behavior Packs Available Pool */}
              <div className="available-pool pt-3 border-top">
                <span className="text-xs text-uppercase font-bold text-sub mb-2 d-block">
                  Available (Inactive) Behavior Packs ({inactiveBP.length}):
                </span>
                {inactiveBP.length === 0 ? (
                  <p className="text-muted text-xs italic m-0">All installed behavior packs are active.</p>
                ) : (
                  <div className="d-flex flex-wrap gap-2">
                    {inactiveBP.map((pack) => {
                      const packDb = addonsList.find(a => a.uuid === pack.uuid) || pack;
                      const comp = packDb.group_id ? addonsList.find(a => a.group_id === packDb.group_id && a.uuid !== packDb.uuid) : null;
                      const chipIconUuid = (packDb.hasIcon && packDb.uuid) || (comp?.hasIcon && comp.uuid) || pack.uuid;
                      const hasChipIcon = Boolean(packDb.hasIcon || comp?.hasIcon);
                      return (
                        <button
                          key={pack.uuid}
                          type="button"
                          className="available-chip"
                          onClick={() => {
                            const v = typeof pack.version === 'string'
                              ? pack.version.split('.').map((n) => parseInt(n, 10) || 0)
                              : (Array.isArray(pack.version) ? pack.version : [1, 0, 0]);
                            setActiveBP([...activeBP, { uuid: pack.uuid, version: v, name: getCleanPackName(pack) }]);
                          }}
                          title={`Click to add ${getCleanPackName(pack)} to active list`}
                        >
                          <div className="available-chip-icon-wrap">
                            {hasChipIcon ? (
                              <img
                                src={`/api/addons/${chipIconUuid}/icon`}
                                alt=""
                                className="available-chip-icon-img"
                                onError={(e) => {
                                  e.target.style.display = 'none';
                                  const fallback = e.target.parentElement.querySelector('.available-chip-icon-fallback');
                                  if (fallback) fallback.style.display = 'inline';
                                }}
                              />
                            ) : null}
                            <span className="available-chip-icon-fallback" style={{ display: hasChipIcon ? 'none' : 'inline' }}>⚙️</span>
                          </div>
                          <span>{getCleanPackName(pack)}</span>
                          <span className="chip-plus">+</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>


            {/* COLUMN 2: ACTIVE RESOURCE PACKS */}
            <div className="pack-order-column modern-card p-4">
              <div className="column-header mb-3 pb-3 border-bottom d-flex justify-between items-center">
                <div>
                  <h3 className="section-title text-base m-0 d-flex items-center gap-2">
                    <span className="badge badge-resource">Resource Packs</span>
                    <span>Active Queue ({displayedActiveRP.length})</span>
                  </h3>
                  <p className="text-muted text-xs m-0 mt-0.5">Top-most pack textures override lower ones.</p>
                </div>
              </div>

              <div className="pack-reorder-list mb-4">
                {displayedActiveRP.length === 0 ? (
                  <div className="empty-state py-6 border-dashed rounded text-center text-muted text-sm">
                    No active resource packs. Click any pack below to activate.
                  </div>
                ) : (
                  displayedActiveRP.map((pack, idx) => {
                    const isDraggingThis = draggedItem?.type === 'rp' && draggedItem?.index === idx;
                    const isDropTarget = dragOverIndex === idx && draggedItem?.type === 'rp';
                    const isSystem = systemUuidsSet.has(pack.uuid);
                    const dbAddon = addonsList.find((a) => a.uuid === pack.uuid);
                    const cleanTitle = dbAddon ? getCleanPackName(dbAddon) : (pack.name && pack.name !== 'pack.name' ? pack.name : 'Bedrock Pack');
                    const companion = dbAddon?.group_id ? addonsList.find(a => a.group_id === dbAddon.group_id && a.uuid !== dbAddon.uuid) : null;
                    const hasIcon = Boolean(dbAddon?.hasIcon || companion?.hasIcon);
                    const iconUuid = (dbAddon?.hasIcon && dbAddon.uuid) || (companion?.hasIcon && companion.uuid) || pack.uuid;

                    return (
                      <div
                        key={pack.uuid || idx}
                        draggable={isAdmin}
                        onDragStart={(e) => handleItemDragStart(e, idx, 'rp')}
                        onDragOver={(e) => handleItemDragOver(e, idx)}
                        onDrop={(e) => handleItemDrop(e, idx, 'rp')}
                        onDragEnd={handleItemDragEnd}
                        className={`pack-item-modern ${isDraggingThis ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}`}
                      >
                        <div className="pack-drag-handle" title="Drag to reorder">
                          ⋮⋮
                        </div>
                        <div className="pack-order-badge rp-badge">#{idx + 1}</div>

                        {/* Pack Logo / Icon */}
                        <div className="pack-item-icon-wrap" title={cleanTitle}>
                          {hasIcon ? (
                            <img
                              src={`/api/addons/${iconUuid}/icon`}
                              alt=""
                              className="pack-item-icon-img"
                              onError={(e) => {
                                e.target.style.display = 'none';
                                const fallback = e.target.parentElement.querySelector('.pack-item-icon-fallback');
                                if (fallback) fallback.style.display = 'flex';
                              }}
                            />
                          ) : null}
                          <span
                            className="pack-item-icon-fallback"
                            style={{ display: hasIcon ? 'none' : 'flex' }}
                          >
                            🎨
                          </span>
                        </div>

                        <div className="pack-info flex-1 min-w-0">
                          <div className="d-flex items-center gap-2">
                            <span className="pack-item-name font-bold text-white truncate">{cleanTitle}</span>
                            {isSystem && (
                              <span className="badge badge-system text-xs py-0 px-1">⚙️ System</span>
                            )}
                          </div>
                          <div className="pack-item-meta text-xs text-muted font-mono">
                            v{pack.version} • {pack.uuid.substring(0, 8)}...
                          </div>
                        </div>

                        {isAdmin && (
                          <div className="pack-order-controls d-flex items-center gap-1">
                            <button
                              type="button"
                              className="btn-order-arrow"
                              onClick={() => moveActivePack('rp', idx, idx - 1, displayedActiveRP)}
                              disabled={idx === 0}
                              title="Move Up"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              className="btn-order-arrow"
                              onClick={() => moveActivePack('rp', idx, idx + 1, displayedActiveRP)}
                              disabled={idx === displayedActiveRP.length - 1}
                              title="Move Down"
                            >
                              ▼
                            </button>
                            <button
                              type="button"
                              className="btn-order-remove"
                              onClick={() => {
                                const newRP = activeRP.filter((p) => p.uuid !== pack.uuid);
                                setActiveRP(newRP);
                              }}
                              title="Remove from active"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Inactive Resource Packs Available Pool */}
              <div className="available-pool pt-3 border-top">
                <span className="text-xs text-uppercase font-bold text-sub mb-2 d-block">
                  Available (Inactive) Resource Packs ({inactiveRP.length}):
                </span>
                {inactiveRP.length === 0 ? (
                  <p className="text-muted text-xs italic m-0">All installed resource packs are active.</p>
                ) : (
                  <div className="d-flex flex-wrap gap-2">
                    {inactiveRP.map((pack) => {
                      const packDb = addonsList.find(a => a.uuid === pack.uuid) || pack;
                      const comp = packDb.group_id ? addonsList.find(a => a.group_id === packDb.group_id && a.uuid !== packDb.uuid) : null;
                      const chipIconUuid = (packDb.hasIcon && packDb.uuid) || (comp?.hasIcon && comp.uuid) || pack.uuid;
                      const hasChipIcon = Boolean(packDb.hasIcon || comp?.hasIcon);
                      return (
                        <button
                          key={pack.uuid}
                          type="button"
                          className="available-chip"
                          onClick={() => {
                            const v = typeof pack.version === 'string'
                              ? pack.version.split('.').map((n) => parseInt(n, 10) || 0)
                              : (Array.isArray(pack.version) ? pack.version : [1, 0, 0]);
                            setActiveRP([...activeRP, { uuid: pack.uuid, version: v, name: getCleanPackName(pack) }]);
                          }}
                          title={`Click to add ${getCleanPackName(pack)} to active list`}
                        >
                          <div className="available-chip-icon-wrap">
                            {hasChipIcon ? (
                              <img
                                src={`/api/addons/${chipIconUuid}/icon`}
                                alt=""
                                className="available-chip-icon-img"
                                onError={(e) => {
                                  e.target.style.display = 'none';
                                  const fallback = e.target.parentElement.querySelector('.available-chip-icon-fallback');
                                  if (fallback) fallback.style.display = 'inline';
                                }}
                              />
                            ) : null}
                            <span className="available-chip-icon-fallback" style={{ display: hasChipIcon ? 'none' : 'inline' }}>🎨</span>
                          </div>
                          <span>{getCleanPackName(pack)}</span>
                          <span className="chip-plus">+</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODE 3: SUGGESTIONS & SWAPS
          ========================================================================= */}
      {engineMode === 'suggestions' && (
        <div className="engine-mode-content">
          {/* Suggestions Toolbar & Information Banner */}
          <div className="modern-card p-4 mb-4">
            <div className="d-flex justify-between items-center flex-wrap gap-3">
              <div>
                <h2 className="text-lg font-bold text-white d-flex items-center gap-2 m-0">
                  <span>💡</span>
                  <span>Smart Pack Suggestions &amp; Location Swapper</span>
                </h2>
                <p className="text-xs text-sub mt-1 mb-0">
                  Detects add-ons showing errors during server execution, mislabeled pack manifests, and inverted behavior/resource pack directories.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary d-flex items-center gap-1.5"
                onClick={loadSuggestions}
                disabled={loadingSuggestions}
              >
                <span>{loadingSuggestions ? '⏳' : '🔄'}</span>
                <span>{loadingSuggestions ? 'Scanning...' : 'Re-Scan Packs & Server Logs'}</span>
              </button>
            </div>
          </div>

          {/* Active Suggestions List */}
          {loadingSuggestions ? (
            <div className="modern-card p-5 text-center text-sub mb-4">
              <div className="loading-spinner mb-2">⏳</div>
              <p className="m-0">Analyzing pack manifests, directory contents, and server console logs...</p>
            </div>
          ) : suggestions.length > 0 ? (
            <div className="d-flex flex-column gap-3 mb-5">
              {suggestions.map((sug) => {
                const isDual = Boolean(sug.isDualPack);
                return (
                  <div key={sug.id} className="modern-card p-4 border border-warning">
                    <div className="d-flex justify-between items-start flex-wrap gap-2 mb-2">
                      <div>
                        <div className="d-flex items-center gap-2">
                          <span className={`badge ${sug.severity === 'critical' ? 'badge-danger' : 'badge-warning'} font-bold uppercase`}>
                            {sug.severity}
                          </span>
                          <h4 className="text-white font-bold m-0 text-base">{sug.title}</h4>
                        </div>
                        <p className="text-xs text-sub mt-1 mb-0">{sug.reason}</p>
                      </div>
                      <div className="d-flex items-center gap-2">
                        <span className="badge badge-behavior">
                          From: {sug.currentType === 'behavior' ? 'behavior_packs/' : 'resource_packs/'}
                        </span>
                        <span className="text-white text-xs">➔</span>
                        <span className="badge badge-resource font-bold">
                          To: {sug.suggestedType === 'resource' ? 'resource_packs/' : 'behavior_packs/'}
                        </span>
                      </div>
                    </div>

                    {sug.details && (
                      <div className="p-2.5 bg-darker rounded text-xs text-sub mb-3 font-mono">
                        {sug.details}
                      </div>
                    )}

                    {sug.serverErrors && sug.serverErrors.length > 0 && (
                      <div className="mb-3 p-2.5 bg-black rounded border border-danger">
                        <span className="text-xs text-danger font-bold d-block mb-1">
                          ⚠️ BDS Console Log Error(s) Captured for this Pack:
                        </span>
                        {sug.serverErrors.map((errLine, eIdx) => (
                          <div key={eIdx} className="font-mono text-xs text-danger truncate" title={errLine}>
                            {errLine}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="d-flex justify-end items-center gap-2 mt-2">
                      {isDual && (
                        <button
                          type="button"
                          className="btn btn-primary d-flex items-center gap-1.5 font-bold"
                          onClick={() => handleSwapPack({ uuid: sug.uuid, name: sug.packName, group_id: true }, true)}
                          disabled={swappingUuid === sug.uuid}
                        >
                          <span>🔀</span>
                          <span>Swap Both Packs (Invert BP ⇄ RP)</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-warning d-flex items-center gap-1.5 font-bold"
                        onClick={() => handleSwapPack({ uuid: sug.uuid, name: sug.packName }, false)}
                        disabled={swappingUuid === sug.uuid}
                      >
                        <span>🔄</span>
                        <span>Swap Only This Pack Location</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="modern-card p-5 text-center mb-5 border border-success">
              <span className="text-3xl mb-2 d-block">✅</span>
              <h3 className="text-white font-bold mb-1">All Addon Locations Verified</h3>
              <p className="text-xs text-sub max-w-lg mx-auto mb-3">
                No directory mismatches, reversed dual-pack companions, or runtime pack stack errors were found across your installed packs.
              </p>
            </div>
          )}

          {/* Manual Pack Location Switcher Quick-Table */}
          <div className="modern-card p-4">
            <h3 className="text-base font-bold text-white mb-2 d-flex items-center gap-2">
              <span>🔧</span>
              <span>Manual Pack Location Switcher</span>
            </h3>
            <p className="text-xs text-sub mb-3">
              Need to swap an add-on manually? If any imported pack isn't behaving properly, you can move it between <code>behavior_packs/</code> and <code>resource_packs/</code> here with one click:
            </p>

            <div className="table-responsive">
              <table className="table-modern w-100">
                <thead>
                  <tr>
                    <th>Pack Name</th>
                    <th>Current Location</th>
                    <th>Dual-Pack</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {addonsList.filter(a => !a.is_system).map((addon) => {
                    const hasComp = Boolean(addon.group_id);
                    const isBP = addon.type === 'behavior';
                    return (
                      <tr key={addon.uuid}>
                        <td>
                          <div className="d-flex items-center gap-2">
                            <span className="text-base">{isBP ? '⚙️' : '🎨'}</span>
                            <div>
                              <div className="text-white font-bold text-xs">{addon.display_name || addon.name}</div>
                              <div className="text-muted font-mono text-xs">{addon.uuid.substring(0, 8)}...</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${isBP ? 'badge-behavior' : 'badge-resource'}`}>
                            {isBP ? 'behavior_packs/ (BP)' : 'resource_packs/ (RP)'}
                          </span>
                        </td>
                        <td>
                          {hasComp ? (
                            <span className="badge badge-dual-pack">🔗 Dual-Pack</span>
                          ) : (
                            <span className="text-sub text-xs">Standalone</span>
                          )}
                        </td>
                        <td>
                          <div className="d-flex gap-2">
                            <button
                              type="button"
                              className="btn btn-secondary btn-xs d-flex items-center gap-1"
                              onClick={() => handleSwapPack(addon, false)}
                              disabled={swappingUuid === addon.uuid}
                              title={`Move to ${isBP ? 'resource_packs/' : 'behavior_packs/'}`}
                            >
                              <span>🔄</span>
                              <span>Move to {isBP ? 'Resource' : 'Behavior'}</span>
                            </button>
                            {hasComp && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-xs d-flex items-center gap-1 text-emerald"
                                onClick={() => handleSwapPack(addon, true)}
                                disabled={swappingUuid === addon.uuid}
                                title="Invert both packs in this dual-pack pair"
                              >
                                <span>🔀</span>
                                <span>Invert Pair</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODE 4: AI DIAGNOSTICS ENGINE
          ========================================================================= */}
      {engineMode === 'diagnostics' && (
        <div className="engine-mode-content">
          {/* Diagnostics Toolbar */}
          <div className="modern-card p-4 mb-5 d-flex justify-between items-center flex-wrap gap-3">
            <div>
              <h3 className="section-title text-base m-0 d-flex items-center gap-2">
                <span>🩺</span>
                <span>Automated Diagnostics &amp; AI Health Scanner</span>
              </h3>
              <p className="text-sub text-xs m-0 mt-1">
                Scans for asymmetric dual-pack pairs, antiquated schemas, definition collisions, and estimates server lag potential.
              </p>
            </div>
            <div className="d-flex items-center gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowKeyInput(!showKeyInput)}
              >
                🔑 {geminiApiKey ? 'Gemini Key Configured' : 'Configure Gemini API Key'}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={runDiagnostics}
                disabled={loadingDiagnostics}
              >
                {loadingDiagnostics ? '🔄 Scanning...' : '🚀 Re-Run Diagnostics'}
              </button>
            </div>
          </div>

          {/* Gemini API Key input drawer */}
          {showKeyInput && (
            <div className="modern-card p-4 mb-5 border-emerald">
              <label className="field-label-bold text-white mb-1 d-block">
                Custom Google Gemini API Key:
              </label>
              <p className="text-sub text-xs mb-3">
                Keys are stored locally in your browser's <code>localStorage</code> and transmitted via encrypted headers (<code>X-Gemini-Key</code>) exclusively for diagnostics analysis.
              </p>
              <div className="d-flex gap-2">
                <input
                  type="password"
                  className="input-modern flex-1"
                  placeholder="AIzaSy..."
                  value={geminiApiKey}
                  onChange={(e) => handleSaveGeminiKey(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    handleSaveGeminiKey('');
                  }}
                >
                  Clear Key
                </button>
              </div>
            </div>
          )}

          {loadingDiagnostics ? (
            <div className="loading-container py-12 text-center modern-card">
              <div className="spinner mb-3" />
              <p className="text-white font-bold mb-1">Scanning manifest schemas, script hooks &amp; asset trees...</p>
              <p className="text-muted text-xs">Heuristics engine inspecting active world configuration</p>
            </div>
          ) : diagnosticsReport ? (
            <div className="diagnostics-results-wrapper">
              {/* LAG POTENTIAL & PERFORMANCE IMPACT METER */}
              <div className="modern-card p-5 mb-5">
                <div className="d-flex justify-between items-center mb-3">
                  <div>
                    <span className="text-xs text-uppercase font-bold text-muted">PERFORMANCE RATING</span>
                    <h3 className="text-xl font-bold text-white m-0 d-flex items-center gap-2">
                      <span>⚡ Estimated Lag Potential:</span>
                      <span
                        className={`badge ${
                          diagnosticsReport.lagMeter.score <= 30
                            ? 'badge-success'
                            : diagnosticsReport.lagMeter.score <= 60
                            ? 'badge-secondary'
                            : diagnosticsReport.lagMeter.score <= 80
                            ? 'badge-primary'
                            : 'badge-danger'
                        }`}
                      >
                        {diagnosticsReport.lagMeter.rating} ({diagnosticsReport.lagMeter.score}%)
                      </span>
                    </h3>
                  </div>
                  <span className="text-xs text-muted font-mono">
                    Target: {diagnosticsReport.worldName}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="metric-progress-bg mb-4" style={{ height: '10px' }}>
                  <div
                    className="metric-progress-fill"
                    style={{
                      width: `${diagnosticsReport.lagMeter.score}%`,
                      background:
                        diagnosticsReport.lagMeter.score <= 30
                          ? 'linear-gradient(90deg, #10b981 0%, #34d399 100%)'
                          : diagnosticsReport.lagMeter.score <= 60
                          ? 'linear-gradient(90deg, #3b82f6 0%, #f59e0b 100%)'
                          : 'linear-gradient(90deg, #f59e0b 0%, #ef4444 100%)',
                    }}
                  />
                </div>

                {/* Contributing Indicators */}
                <div className="contributing-indicators-card p-3 rounded bg-darker">
                  <span className="text-xs text-sub font-bold d-block mb-1.5">
                    📊 Contributing Indicators:
                  </span>
                  <ul className="m-0 pl-4 text-xs text-sub">
                    {diagnosticsReport.lagMeter.contributingIndicators.map((ind, i) => (
                      <li key={i} className="mb-0.5">
                        {ind}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* GOOGLE GEMINI GENERATIVE INSIGHTS (IF CONFIGURED) */}
              {diagnosticsReport.aiInsights && (
                <div className="modern-card p-5 mb-5 border-emerald" style={{ background: 'rgba(16, 185, 129, 0.05)' }}>
                  <div className="d-flex items-center gap-2 mb-2">
                    <span className="text-lg">✨</span>
                    <h4 className="text-sm font-bold text-white m-0">Google Gemini Diagnostics Analysis</h4>
                  </div>
                  <div className="gemini-markdown-text text-sm text-sub whitespace-pre-wrap leading-relaxed">
                    {diagnosticsReport.aiInsights}
                  </div>
                </div>
              )}

              {/* DIAGNOSTIC ISSUES LIST */}
              <div className="modern-card p-5">
                <div className="d-flex justify-between items-center mb-4">
                  <h4 className="section-title text-base m-0 d-flex items-center gap-2">
                    <span>🔍</span>
                    <span>Detected Issues &amp; Inconsistencies ({diagnosticsReport.issues.length})</span>
                  </h4>
                  {diagnosticsReport.issues.length === 0 && (
                    <span className="badge badge-success">✓ 100% Clean Configuration</span>
                  )}
                </div>

                {diagnosticsReport.issues.length === 0 ? (
                  <div className="text-center py-6 text-muted">
                    <span className="text-3xl d-block mb-2">🎉</span>
                    <p className="text-white font-bold mb-1">No Pack Conflicts Detected</p>
                    <p className="text-xs text-sub m-0">
                      All dual-packs are symmetrically paired, manifests follow modern schemas, and zero critical file collisions exist.
                    </p>
                  </div>
                ) : (
                  <div className="diagnostic-issues-list d-flex flex-column gap-3">
                    {diagnosticsReport.issues.map((issue) => (
                      <div key={issue.id} className={`diagnostic-issue-card severity-${issue.severity}`}>
                        <div className="issue-left">
                          <span className="issue-badge">
                            {issue.severity === 'warning' ? '⚠️ Warning' : 'ℹ️ Notice'}
                          </span>
                          <div className="issue-info">
                            <h5 className="issue-title text-white font-bold m-0">{issue.title}</h5>
                            <p className="issue-desc text-sub text-xs m-0 mt-1">{issue.description}</p>
                          </div>
                        </div>

                        {issue.fixable && isAdmin && (
                          <div className="issue-action">
                            <button
                              type="button"
                              className="btn btn-primary btn-xs"
                              onClick={() => handleAutoFix(issue.fixAction, issue.targetUuid)}
                              disabled={autoFixingId === issue.targetUuid}
                            >
                              {autoFixingId === issue.targetUuid ? '⚙️ Fixing...' : '⚡ Auto-Fix It'}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* =========================================================================
          MODAL: EDIT ADDON SETTINGS & METADATA
          ========================================================================= */}
      {editModalAddon && (
        <div className="modal-overlay" onClick={() => !savingEdit && setEditModalAddon(null)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="modal-header">
              <h3 className="modal-title">✏️ Edit Addon Metadata &amp; Settings</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => !savingEdit && setEditModalAddon(null)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit}>
              <div className="modal-body p-5">
                <div className="form-group-modern mb-4">
                  <label className="field-label-bold">Addon Display Name:</label>
                  <input
                    type="text"
                    required
                    className="input-modern"
                    value={editForm.displayName}
                    onChange={(e) => setEditForm({ ...editForm, displayName: e.target.value })}
                  />
                  <small className="field-hint text-sub mt-1 d-block">
                    Customize how this pack appears on the dashboard without modifying original zip archives.
                  </small>
                </div>

                <div className="form-group-modern mb-4">
                  <label className="field-label-bold">Pack Category / Type Switcher:</label>
                  <select
                    className="input-modern select-modern"
                    value={editForm.type}
                    onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                  >
                    <option value="behavior">Behavior Pack (behavior_packs/)</option>
                    <option value="resource">Resource Pack (resource_packs/)</option>
                  </select>
                  <small className="field-hint text-sub mt-1 d-block">
                    Switching categories automatically moves physical files on disk between <code>behavior_packs/</code> and <code>resource_packs/</code>.
                  </small>
                </div>

                {!editModalAddon.is_system && (
                  <div className="form-group-modern mb-4 p-3 bg-darker rounded border border-warning">
                    <div className="d-flex justify-between items-center mb-1 flex-wrap gap-1">
                      <span className="field-label-bold m-0 text-warning font-bold text-xs d-flex items-center gap-1">
                        <span>🔄</span>
                        <span>Swap Pack Location (BP ⇄ RP)</span>
                      </span>
                      <span className={`badge ${editModalAddon.type === 'behavior' ? 'badge-behavior' : 'badge-resource'} text-xs`}>
                        Currently: {editModalAddon.type === 'behavior' ? 'Behavior (BP)' : 'Resource (RP)'}
                      </span>
                    </div>
                    <p className="text-xs text-sub mb-3">
                      If this pack was imported into the wrong directory or textures/behaviors aren't showing in-game, you can swap its location:
                    </p>
                    <div className="d-flex gap-2 flex-wrap">
                      <button
                        type="button"
                        className="btn btn-warning btn-sm d-flex items-center gap-1.5 font-bold"
                        onClick={() => handleSwapPack(editModalAddon, false)}
                        disabled={swappingUuid === editModalAddon.uuid}
                        title={`Move from ${editModalAddon.type === 'behavior' ? 'behavior_packs' : 'resource_packs'} to ${editModalAddon.type === 'behavior' ? 'resource_packs' : 'behavior_packs'}`}
                      >
                        <span>{swappingUuid === editModalAddon.uuid ? '⏳' : '🔄'}</span>
                        <span>
                          {swappingUuid === editModalAddon.uuid
                            ? 'Swapping...'
                            : `Swap to ${editModalAddon.type === 'behavior' ? 'Resource Pack (resource_packs/)' : 'Behavior Pack (behavior_packs/)'}`}
                        </span>
                      </button>

                      {editModalAddon.group_id && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm d-flex items-center gap-1.5 font-bold text-emerald"
                          onClick={() => handleSwapPack(editModalAddon, true)}
                          disabled={swappingUuid === editModalAddon.uuid}
                          title="Invert both packs in this dual-pack companion pair"
                        >
                          <span>🔀</span>
                          <span>Invert Dual-Pack Pair Roles (BP ⇄ RP)</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="form-group-modern mb-4">
                  <label className="field-label-bold">Addon Description / Notes:</label>
                  <textarea
                    rows={3}
                    className="input-modern"
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  />
                </div>

                <div className="form-group-modern mb-4">
                  <div className="d-flex justify-between items-center mb-1">
                    <label className="field-label-bold m-0">External Download / Source URL (Optional):</label>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs d-flex items-center gap-1"
                      onClick={() => {
                        startUrlWizard([editModalAddon]);
                      }}
                      title="Search web for official addon download or info page"
                    >
                      <span>🔍 Auto Search Online</span>
                    </button>
                  </div>
                  <input
                    type="url"
                    className="input-modern"
                    placeholder="https://example.com/pack-download"
                    value={editForm.downloadUrl}
                    onChange={(e) => setEditForm({ ...editForm, downloadUrl: e.target.value })}
                  />
                  <small className="field-hint text-sub mt-1 d-block">
                    Enables a direct download button on the card for portal viewers and players.
                  </small>
                </div>

                {editModalAddon.group_id && (
                  <div className="p-3 bg-darker rounded border mb-2">
                    <label className="d-flex items-center gap-2 cursor-pointer m-0">
                      <input
                        type="checkbox"
                        checked={editForm.syncGroup}
                        onChange={(e) => setEditForm({ ...editForm, syncGroup: e.target.checked })}
                      />
                      <span className="text-xs text-white font-bold">
                        🔗 Synchronize changes to companion dual-pack
                      </span>
                    </label>
                    <small className="text-sub text-xs d-block mt-1 pl-5">
                      Automatically propagates display name and download URL across both BP and RP counterparts.
                    </small>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditModalAddon(null)}
                  disabled={savingEdit}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingEdit}
                >
                  {savingEdit ? '💾 Saving...' : '💾 Save Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: IN-PLACE PACK UPDATE (UPLOAD CLOUD)
          ========================================================================= */}
      {inPlaceUpdateAddon && (
        <div className="modal-overlay" onClick={() => !inPlaceUpdating && setInPlaceUpdateAddon(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="modal-header">
              <h3 className="modal-title">☁️ In-Place Update: {getCleanPackName(inPlaceUpdateAddon)}</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => !inPlaceUpdating && setInPlaceUpdateAddon(null)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleInPlaceUpdate}>
              <div className="modal-body p-5">
                <p className="text-sub text-sm mb-4">
                  Replaces the files on disk for <strong>"{getCleanPackName(inPlaceUpdateAddon)}"</strong> while preserving your enabled/disabled state, custom settings, and download URLs.
                </p>

                <div
                  className="p-6 border-dashed rounded text-center cursor-pointer mb-4"
                  onClick={() => inPlaceInputRef.current?.click()}
                  style={{ background: 'rgba(255, 255, 255, 0.03)' }}
                >
                  <input
                    type="file"
                    ref={inPlaceInputRef}
                    className="d-none"
                    accept=".mcpack,.mcaddon,.zip"
                    onChange={(e) => setInPlaceFile(e.target.files?.[0] || null)}
                  />
                  <div className="text-2xl mb-1">📦</div>
                  <span className="text-sm font-bold text-white d-block">
                    {inPlaceFile ? inPlaceFile.name : 'Click to select replacement .mcpack or .mcaddon'}
                  </span>
                  {inPlaceFile && (
                    <span className="text-xs text-emerald mt-1 font-mono d-block">
                      Ready to install ({(inPlaceFile.size / 1024 / 1024).toFixed(2)} MB)
                    </span>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setInPlaceUpdateAddon(null)}
                  disabled={inPlaceUpdating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!inPlaceFile || inPlaceUpdating}
                >
                  {inPlaceUpdating ? 'Installing Update...' : '🚀 Replace & Update Pack'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: DELETE PACK CONFIRMATION
          ========================================================================= */}
      {deleteModalPack && (() => {
        const companion = deleteModalPack.group_id
          ? addonsList.find((a) => a.group_id === deleteModalPack.group_id && a.uuid !== deleteModalPack.uuid)
          : null;

        return (
          <div className="modal-overlay" onClick={() => !isDeleting && setDeleteModalPack(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog">
              <div className="modal-header">
                <h3 className="modal-title">Uninstall Addon Pack</h3>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => !isDeleting && setDeleteModalPack(null)}
                >
                  ✕
                </button>
              </div>

              <div className="modal-body p-5">
                <p className="text-white mb-2">
                  Are you sure you want to uninstall and remove <strong>"{getCleanPackName(deleteModalPack)}"</strong>?
                </p>
                <div className="p-3 bg-darker rounded font-mono text-xs text-sub mb-3">
                  UUID: {deleteModalPack.uuid}<br />
                  Type: {deleteModalPack.type === 'resource' ? 'Resource Pack' : 'Behavior Pack'}
                </div>

                {companion && (
                  <div className="p-3 rounded mb-3" style={{ background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                    <div className="d-flex items-center gap-2 mb-2 text-purple font-semibold text-sm">
                      <span>🔗</span>
                      <span>Paired Companion Dual-Pack Detected</span>
                    </div>
                    <p className="text-xs text-sub mb-3">
                      This pack is paired with <strong>"{getCleanPackName(companion)}"</strong> ({companion.type === 'resource' ? 'Resource Pack' : 'Behavior Pack'}). How would you like to delete it?
                    </p>
                    <div className="d-flex flex-col gap-2">
                      <label
                        className="d-flex items-center gap-2 cursor-pointer text-xs text-white p-2 rounded"
                        style={{
                          background: deleteCompanionChoice === 'both' ? 'rgba(168, 85, 247, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                          border: deleteCompanionChoice === 'both' ? '1px solid rgba(168, 85, 247, 0.6)' : '1px solid transparent',
                        }}
                      >
                        <input
                          type="radio"
                          name="deleteCompanionOption"
                          value="both"
                          checked={deleteCompanionChoice === 'both'}
                          onChange={() => setDeleteCompanionChoice('both')}
                        />
                        <span>
                          <strong>Delete both companion packs</strong> (Recommended) — Uninstalls both paired Behavior and Resource packs cleanly from the server.
                        </span>
                      </label>
                      <label
                        className="d-flex items-center gap-2 cursor-pointer text-xs text-white p-2 rounded"
                        style={{
                          background: deleteCompanionChoice === 'single' ? 'rgba(168, 85, 247, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                          border: deleteCompanionChoice === 'single' ? '1px solid rgba(168, 85, 247, 0.6)' : '1px solid transparent',
                        }}
                      >
                        <input
                          type="radio"
                          name="deleteCompanionOption"
                          value="single"
                          checked={deleteCompanionChoice === 'single'}
                          onChange={() => setDeleteCompanionChoice('single')}
                        />
                        <span>
                          <strong>Delete only this {deleteModalPack.type === 'resource' ? 'Resource' : 'Behavior'} pack</strong> — Keeps "{getCleanPackName(companion)}" installed.
                        </span>
                      </label>
                    </div>
                  </div>
                )}

                <div className="alert-toast alert-error">
                  ⚠️ This will permanently remove the pack directory from the server and unbind it from active worlds.
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setDeleteModalPack(null)}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => handleDeletePack(deleteModalPack.uuid, Boolean(companion && deleteCompanionChoice === 'both'))}
                  disabled={isDeleting}
                >
                  {isDeleting
                    ? 'Deleting...'
                    : companion && deleteCompanionChoice === 'both'
                    ? '🗑️ Delete Both Companion Packs'
                    : '🗑️ Confirm Delete'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* =========================================================================
          MODAL: BATCH DELETE CONFIRMATION
          ========================================================================= */}
      {batchDeleteModalOpen && (
        <div className="modal-overlay" onClick={() => !bulkProcessing && setBatchDeleteModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="modal-header">
              <h3 className="modal-title">🗑️ Delete Selected Addon Packs</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => !bulkProcessing && setBatchDeleteModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body p-5">
              <p className="text-white mb-2">
                Are you sure you want to permanently delete <strong>{selectedUuids.size} selected pack(s)</strong>?
              </p>

              <div className="p-3 bg-darker rounded mb-3 max-h-48 overflow-y-auto">
                <span className="text-xs text-sub d-block mb-1 font-semibold uppercase">Packs to be removed:</span>
                <ul className="text-xs text-white list-disc pl-4 space-y-1">
                  {addonsList
                    .filter((a) => selectedUuids.has(a.uuid))
                    .map((a) => (
                      <li key={a.uuid}>
                        <strong className="text-white">{getCleanPackName(a)}</strong>{' '}
                        <span className="text-sub font-mono">({a.type === 'resource' ? 'RP' : 'BP'}, {a.version || 'v1.0.0'})</span>
                        {a.group_id && <span className="text-purple ml-2 font-semibold">🔗 Paired Dual-Pack</span>}
                      </li>
                    ))}
                </ul>
              </div>

              {/* Companion Dual-Pack Checkbox Option */}
              <div className="p-3 rounded mb-3" style={{ background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                <label className="d-flex items-center gap-2 cursor-pointer text-xs text-white">
                  <input
                    type="checkbox"
                    checked={batchIncludeCompanions}
                    onChange={(e) => setBatchIncludeCompanions(e.target.checked)}
                  />
                  <span>
                    <strong>Include paired companion dual-packs</strong> (Recommended) — Also deletes any companion BP/RP paired with the selected packs.
                  </span>
                </label>
              </div>

              <div className="alert-toast alert-error">
                🚨 WARNING: This action cannot be undone. Files will be deleted from disk and unlinked from active worlds.
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setBatchDeleteModalOpen(false)}
                disabled={bulkProcessing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => handleExecuteBatch('delete_selected', batchIncludeCompanions)}
                disabled={bulkProcessing}
              >
                {bulkProcessing ? 'Deleting Packs...' : `🗑️ Delete ${selectedUuids.size} Selected Packs`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: BULK ACTION CONFIRMATION
          ========================================================================= */}
      {bulkConfirmAction && bulkConfirmAction !== 'menu' && (
        <div className="modal-overlay" onClick={() => !bulkProcessing && setBulkConfirmAction(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="modal-header">
              <h3 className="modal-title">⚠️ Confirm Bulk Operation</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => !bulkProcessing && setBulkConfirmAction(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body p-5">
              {bulkConfirmAction === 'enable_all' && (
                <p className="text-white">
                  Are you sure you want to <strong>Enable All {totalInstalled} installed packs</strong> in the active world?
                </p>
              )}
              {bulkConfirmAction === 'disable_all' && (
                <p className="text-white">
                  Are you sure you want to <strong>Deactivate All packs</strong> from the active world? Packs remain installed on disk.
                </p>
              )}
              {bulkConfirmAction === 'delete_all' && (
                <div className="alert-toast alert-error">
                  🚨 WARNING: This will permanently DELETE all {totalInstalled} packs from disk and database!
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setBulkConfirmAction(null)}
                disabled={bulkProcessing}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${bulkConfirmAction === 'delete_all' ? 'btn-danger' : 'btn-primary'}`}
                onClick={handleExecuteBulk}
                disabled={bulkProcessing}
              >
                {bulkProcessing ? 'Processing...' : 'Confirm Bulk Action'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: ADDON SOURCE URL FINDER & METADATA WIZARD
          ========================================================================= */}
      {urlWizardOpen && urlWizardQueue.length > 0 && (
        <div className="modal-overlay" onClick={() => !urlWizardSaving && !urlWizardAutoSearchingAll && handleWizardSkipAll()}>
          <div className="modal url-wizard-modal" onClick={(e) => e.stopPropagation()} role="dialog" style={{ maxWidth: '680px', width: '92%' }}>
            <div className="modal-header d-flex justify-between items-center">
              <div className="d-flex items-center gap-2">
                <span className="text-xl">🌐</span>
                <div>
                  <h3 className="modal-title m-0">Addon Source URL &amp; Metadata Finder</h3>
                  <span className="text-xs text-sub">
                    {urlWizardQueue.length > 1
                      ? `Pack ${urlWizardIndex + 1} of ${urlWizardQueue.length}`
                      : 'Link official addon download or information page'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={handleWizardSkipAll}
                disabled={urlWizardSaving || urlWizardAutoSearchingAll}
                title="Skip All and close"
              >
                ✕
              </button>
            </div>

            <div className="modal-body p-4">
              {/* Current Pack Banner */}
              {(() => {
                const currentPack = urlWizardQueue[urlWizardIndex];
                if (!currentPack) return null;
                const comp = currentPack.groupId
                  ? addonsList.find((a) => a.group_id === currentPack.groupId && a.uuid !== currentPack.uuid)
                  : null;
                const hasIco = Boolean(currentPack.hasIcon || comp?.hasIcon);
                const icoUuid = (currentPack.hasIcon && currentPack.uuid) || (comp?.hasIcon && comp.uuid) || currentPack.uuid;
                const packTitle = currentPack.displayName || currentPack.name || 'Bedrock Addon';

                return (
                  <div className="wizard-pack-banner mb-4 p-3 rounded d-flex items-center justify-between gap-3">
                    <div className="d-flex items-center gap-3 min-w-0">
                      <div className="wizard-pack-icon-wrap flex-shrink-0">
                        {hasIco ? (
                          <img
                            src={`/api/addons/${icoUuid}/icon`}
                            alt=""
                            className="wizard-pack-icon-img"
                            onError={(e) => {
                              e.target.style.display = 'none';
                              const fallback = e.target.parentElement.querySelector('.wizard-pack-icon-fallback');
                              if (fallback) fallback.style.display = 'flex';
                            }}
                          />
                        ) : null}
                        <div
                          className="wizard-pack-icon-fallback"
                          style={{ display: hasIco ? 'none' : 'flex' }}
                        >
                          🧩
                        </div>
                      </div>
                      <div className="min-w-0">
                        <h4 className="m-0 font-bold text-white text-base truncate">{packTitle}</h4>
                        <div className="text-xs text-muted font-mono mt-0.5">
                          v{currentPack.version || '1.0.0'} • {currentPack.type === 'resource' ? 'Resource Pack' : 'Behavior Pack'}
                          {comp && ' • Paired Dual-Pack'}
                        </div>
                      </div>
                    </div>

                    {/* Actions for multiple uploads */}
                    <div className="d-flex items-center gap-1 flex-shrink-0">
                      {urlWizardQueue.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-primary btn-xs"
                          onClick={handleWizardAutoSearchAll}
                          disabled={urlWizardAutoSearchingAll || urlWizardSearching || urlWizardSaving}
                          title="Auto-search and assign the best URL match for all uploaded packs in queue"
                        >
                          {urlWizardAutoSearchingAll ? '⚡ Auto-Linking...' : '⚡ Auto Search All'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={handleWizardSkipPack}
                        disabled={urlWizardAutoSearchingAll || urlWizardSaving}
                        title="Skip this pack and move to next"
                      >
                        {urlWizardIndex < urlWizardQueue.length - 1 ? 'Skip Pack ⏭️' : 'Skip'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs text-muted"
                        onClick={handleWizardSkipAll}
                        disabled={urlWizardAutoSearchingAll || urlWizardSaving}
                        title="Skip all remaining packs in queue"
                      >
                        Skip All ✕
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Quick Search Preset Pills */}
              <div className="wizard-presets-row">
                <span className="text-xs text-sub font-semibold mr-1">Search presets:</span>
                <button
                  type="button"
                  className="wizard-preset-pill"
                  onClick={() => {
                    const base = (urlWizardQueue[urlWizardIndex]?.displayName || urlWizardQueue[urlWizardIndex]?.name || '')
                      .replace(/\.(mcaddon|mcpack|zip)$/i, '')
                      .replace(/[\s\-_]*(addon|\(addon\)|pack|\(pack\)|behavior|resource|bp|rp)$/i, '')
                      .trim();
                    const q = `${base} minecraft marketplace`;
                    setUrlWizardQuery(q);
                    fetchUrlSearchResults(q, urlWizardQueue[urlWizardIndex]?.uuid);
                  }}
                  disabled={urlWizardSearching || urlWizardSaving || urlWizardAutoSearchingAll}
                  title="Search Minecraft Marketplace PDPs"
                >
                  🏪 Marketplace
                </button>
                <button
                  type="button"
                  className="wizard-preset-pill"
                  onClick={() => {
                    const base = (urlWizardQueue[urlWizardIndex]?.displayName || urlWizardQueue[urlWizardIndex]?.name || '')
                      .replace(/\.(mcaddon|mcpack|zip)$/i, '')
                      .replace(/[\s\-_]*(addon|\(addon\)|pack|\(pack\)|behavior|resource|bp|rp)$/i, '')
                      .trim();
                    const q = `${base} curseforge bedrock`;
                    setUrlWizardQuery(q);
                    fetchUrlSearchResults(q, urlWizardQueue[urlWizardIndex]?.uuid);
                  }}
                  disabled={urlWizardSearching || urlWizardSaving || urlWizardAutoSearchingAll}
                  title="Search CurseForge Bedrock"
                >
                  🔥 CurseForge
                </button>
                <button
                  type="button"
                  className="wizard-preset-pill"
                  onClick={() => {
                    const base = (urlWizardQueue[urlWizardIndex]?.displayName || urlWizardQueue[urlWizardIndex]?.name || '')
                      .replace(/\.(mcaddon|mcpack|zip)$/i, '')
                      .replace(/[\s\-_]*(addon|\(addon\)|pack|\(pack\)|behavior|resource|bp|rp)$/i, '')
                      .trim();
                    const q = `${base} mcpedl`;
                    setUrlWizardQuery(q);
                    fetchUrlSearchResults(q, urlWizardQueue[urlWizardIndex]?.uuid);
                  }}
                  disabled={urlWizardSearching || urlWizardSaving || urlWizardAutoSearchingAll}
                  title="Search MCPEDL"
                >
                  📦 MCPEDL
                </button>
                <button
                  type="button"
                  className="wizard-preset-pill text-sub"
                  onClick={() => {
                    const base = (urlWizardQueue[urlWizardIndex]?.displayName || urlWizardQueue[urlWizardIndex]?.name || '')
                      .replace(/\.(mcaddon|mcpack|zip)$/i, '')
                      .replace(/[\s\-_]*(addon|\(addon\)|pack|\(pack\)|behavior|resource|bp|rp)$/i, '')
                      .trim();
                    setUrlWizardQuery(base);
                    fetchUrlSearchResults(base, urlWizardQueue[urlWizardIndex]?.uuid);
                  }}
                  disabled={urlWizardSearching || urlWizardSaving || urlWizardAutoSearchingAll}
                  title="Reset to pure pack name"
                >
                  ↺ Reset
                </button>
              </div>

              {/* Search Query Bar */}
              <div className="wizard-search-bar mb-3 d-flex gap-2">
                <input
                  type="text"
                  className="input-modern flex-1"
                  placeholder="Search pack name, marketplace URL, or creator..."
                  value={urlWizardQuery}
                  onChange={(e) => setUrlWizardQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      fetchUrlSearchResults(urlWizardQuery, urlWizardQueue[urlWizardIndex]?.uuid);
                    }
                  }}
                  disabled={urlWizardSearching || urlWizardSaving || urlWizardAutoSearchingAll}
                />
                <button
                  type="button"
                  className="btn btn-secondary px-3"
                  onClick={() => fetchUrlSearchResults(urlWizardQuery, urlWizardQueue[urlWizardIndex]?.uuid)}
                  disabled={urlWizardSearching || urlWizardSaving || urlWizardAutoSearchingAll || !urlWizardQuery.trim()}
                >
                  {urlWizardSearching ? 'Searching...' : '🔍 Search Web'}
                </button>
              </div>

              {/* Status / Alert Toasts */}
              {urlWizardError && (
                <div className="alert-toast alert-warning mb-3 py-2 px-3 text-xs">
                  <span>⚠️ {urlWizardError}</span>
                </div>
              )}
              {urlWizardSuccess && (
                <div className="alert-toast alert-success mb-3 py-2 px-3 text-xs">
                  <span>✓ {urlWizardSuccess}</span>
                </div>
              )}

              {/* Results List */}
              <div className="wizard-results-container mb-4">
                <div className="d-flex justify-between items-center mb-2">
                  <span className="text-xs font-bold text-sub text-uppercase tracking-wider">
                    Found Web Options ({urlWizardResults.length}):
                  </span>
                  {urlWizardResults.length > 0 && (
                    <span className="text-xs text-muted">Click "Select" to link pack to URL</span>
                  )}
                </div>

                {urlWizardSearching ? (
                  <div className="py-8 text-center border-dashed rounded">
                    <div className="spinner mb-2" />
                    <p className="text-sub text-sm m-0">
                      Searching Minecraft Marketplace, CurseForge, MCPEDL, Chunk, and the web...
                    </p>
                  </div>
                ) : urlWizardResults.length === 0 ? (
                  <div className="py-6 text-center border-dashed rounded text-muted text-sm">
                    No web results loaded yet. Click <strong>"Search Web"</strong> or enter a custom URL below.
                  </div>
                ) : (
                  <div className="wizard-results-list d-flex flex-column gap-2" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                    {urlWizardResults.map((item, idx) => {
                      const isOfficial = item.isOfficialMarketplace;
                      const isMarket = item.isMarketplace;
                      const cardClass = `wizard-result-card p-3 rounded d-flex items-start gap-3 ${
                        isOfficial || isMarket ? 'marketplace-highlight' : ''
                      }`;

                      return (
                        <div key={item.url || idx} className={cardClass}>
                          <div className="wizard-result-thumb-wrap flex-shrink-0">
                            {item.image ? (
                              <img
                                src={item.image}
                                alt=""
                                className="wizard-result-thumb-img"
                                onError={(e) => {
                                  e.target.style.display = 'none';
                                  const fallback = e.target.parentElement.querySelector('.wizard-result-thumb-fallback');
                                  if (fallback) fallback.style.display = 'flex';
                                }}
                              />
                            ) : null}
                            <div
                              className="wizard-result-thumb-fallback"
                              style={{ display: item.image ? 'none' : 'flex' }}
                            >
                              {isOfficial ? '🏪' : '🌐'}
                            </div>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="d-flex items-center gap-2 mb-0.5 flex-wrap">
                              {isOfficial ? (
                                <span className="badge badge-official text-xs py-0 px-1 font-mono">
                                  ⭐ Minecraft Marketplace (Official)
                                </span>
                              ) : isMarket ? (
                                <span className="badge badge-marketplace text-xs py-0 px-1 font-mono">
                                  🛒 {item.siteName || 'Marketplace'}
                                </span>
                              ) : item.siteName ? (
                                <span className="badge badge-system text-xs py-0 px-1 font-mono">
                                  {item.siteName}
                                </span>
                              ) : null}

                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="wizard-result-link font-semibold text-white text-sm truncate flex-1 hover:underline"
                                title={item.title}
                              >
                                {item.title} ↗
                              </a>
                            </div>
                            {item.snippet ? (
                              <p className="wizard-result-snippet text-xs text-muted m-0">
                                {item.snippet}
                              </p>
                            ) : null}
                            <span className="text-xs text-sub font-mono truncate d-block mt-0.5" style={{ opacity: 0.7 }}>
                              {item.url}
                            </span>
                          </div>

                          <button
                            type="button"
                            className="btn btn-primary btn-sm flex-shrink-0"
                            onClick={() => handleAssignUrl(item.url)}
                            disabled={urlWizardSaving || urlWizardAutoSearchingAll}
                          >
                            Select ✓
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Custom URL Input Section */}
              <div className="wizard-custom-url-box p-3 rounded border">
                <label className="text-xs font-bold text-white mb-1.5 d-block">
                  Or Input Custom URL Manually:
                </label>
                <div className="d-flex gap-2">
                  <input
                    type="url"
                    className="input-modern flex-1 text-sm"
                    placeholder="https://www.curseforge.com/... or https://mcpedl.com/..."
                    value={urlWizardCustomUrl}
                    onChange={(e) => setUrlWizardCustomUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (urlWizardCustomUrl.trim()) handleAssignUrl(urlWizardCustomUrl.trim());
                      }
                    }}
                    disabled={urlWizardSaving || urlWizardAutoSearchingAll}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary text-sm px-3"
                    onClick={() => handleAssignUrl(urlWizardCustomUrl.trim())}
                    disabled={!urlWizardCustomUrl.trim() || urlWizardSaving || urlWizardAutoSearchingAll}
                  >
                    Save URL
                  </button>
                </div>
              </div>
            </div>

            <div className="modal-footer d-flex justify-between items-center">
              <span className="text-xs text-muted">
                {urlWizardQueue.length > 1
                  ? `${urlWizardQueue.length - urlWizardIndex} pack(s) remaining in queue`
                  : 'Changes automatically sync to paired companion pack'}
              </span>
              <div className="d-flex gap-2">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleWizardSkipPack}
                  disabled={urlWizardSaving || urlWizardAutoSearchingAll}
                >
                  {urlWizardIndex < urlWizardQueue.length - 1 ? 'Skip This Pack' : 'Close'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: SWAP PACK LOCATION CONFIRMATION (BP <-> RP)
          ========================================================================= */}
      {swapConfirmModal && (
        <div className="modal-overlay" onClick={() => !swappingUuid && setSwapConfirmModal(null)}>
          <div className="modal modal-md" onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="modal-header">
              <h3 className="modal-title">🔄 Swap Pack Location (BP ⇄ RP)</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => !swappingUuid && setSwapConfirmModal(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body p-4">
              <p className="text-white text-sm mb-3">
                You are swapping the storage directory and engine type for <strong>{swapConfirmModal.addon.display_name || swapConfirmModal.addon.name}</strong>.
              </p>
              <div className="p-3 bg-darker rounded mb-3 text-xs">
                <div>
                  <strong>Current Location:</strong> <code>{swapConfirmModal.addon.type === 'behavior' ? 'behavior_packs/' : 'resource_packs/'}</code> ({swapConfirmModal.addon.type === 'behavior' ? 'Behavior Pack' : 'Resource Pack'})
                </div>
                <div className="mt-1 text-emerald">
                  <strong>New Target Location:</strong> <code>{swapConfirmModal.addon.type === 'behavior' ? 'resource_packs/' : 'behavior_packs/'}</code> ({swapConfirmModal.addon.type === 'behavior' ? 'Resource Pack' : 'Behavior Pack'})
                </div>
              </div>
              {swapConfirmModal.addon.group_id && (
                <div className="alert alert-info text-xs mb-3">
                  🔗 <strong>Dual-Pack Companion Detected:</strong> This addon has a paired companion pack. You can invert both packs simultaneously so their roles swap cleanly.
                </div>
              )}
              <p className="text-xs text-sub mb-0">
                This moves the folder on disk, updates manifest module types, and updates the active world load order automatically.
              </p>
            </div>
            <div className="modal-footer d-flex justify-between items-center gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSwapConfirmModal(null)}
                disabled={Boolean(swappingUuid)}
              >
                Cancel
              </button>
              <div className="d-flex gap-2">
                {swapConfirmModal.addon.group_id && (
                  <button
                    type="button"
                    className="btn btn-secondary text-emerald font-bold"
                    onClick={() => handleSwapPack(swapConfirmModal.addon, true)}
                    disabled={Boolean(swappingUuid)}
                  >
                    {swappingUuid ? '⏳ Swapping...' : '🔀 Invert Dual-Pack Roles'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-warning font-bold"
                  onClick={() => handleSwapPack(swapConfirmModal.addon, false)}
                  disabled={Boolean(swappingUuid)}
                >
                  {swappingUuid ? '⏳ Swapping...' : '🔄 Swap Pack Location'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


export default Addons;
