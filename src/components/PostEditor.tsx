'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Eye,
  Link2,
  MessageCircle,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { Group, Post, Platform, Translate, Workspace } from '@/lib/types';
import { canonicalPostUrl } from '@/lib/data';
import { sortCatalog } from '@/lib/catalog';
import {
  knownFacebookGroupHandleName,
  knownFacebookGroupName,
} from '@/lib/facebook-group-directory';
import {
  convertFacebookPendingPostUrl,
  normalizeFacebookGroupPostInput,
  parseFacebookGroupPostLink,
} from '@/lib/facebook-post-url';
import {
  groupFacebookKey,
  groupMatchesFacebookKey,
  resolvePostGroupSelection,
} from '@/lib/post-group-selection';
import { postEditorSnapshot } from '@/lib/post-editor-snapshot';
import { postPublicationStatus } from '@/lib/post-tools';
import { productCompanyIdMap } from '@/lib/product-company';
import { reviewPostLink } from '@/lib/post-link-review';
import SelectionField from './SelectionField';
import CalendarField from './CalendarField';
import styles from './PostEditor.module.css';

type Props = {
  post: Post | null;
  initialUrl?: string;
  data: Workspace;
  companyId: string;
  t: Translate;
  onSave: (post: Post, pendingGroup: Group | null) => Promise<void>;
  onDelete: (post: Post) => Promise<boolean>;
  onClose: () => void;
  onOpenPost: (post: Post, initialUrl?: string) => void;
};
type FacebookPostType = 'group' | 'page';

const bangkokDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function bangkokDateTime(value: string) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '';
  const pieces = bangkokDateTimeFormatter.formatToParts(new Date(value));
  const part = (name: string) => pieces.find((item) => item.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

function toIso(value: string) {
  if (!value) return '';
  const date = new Date(`${value}:00+07:00`);
  return Number.isFinite(date.getTime()) && bangkokDateTime(date.toISOString()) === value
    ? date.toISOString()
    : '';
}

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !!url.hostname &&
      !/[\u0000-\u0020\u007f]/.test(value)
    );
  } catch {
    return false;
  }
}

export default function PostEditor({
  post,
  initialUrl,
  data,
  companyId,
  t,
  onSave,
  onDelete,
  onClose,
  onOpenPost,
}: Props) {
  const originalUrl = normalizeFacebookGroupPostInput(initialUrl ?? post?.url ?? '');
  const convertedStartingUrl = convertFacebookPendingPostUrl(originalUrl);
  const startingUrl = convertedStartingUrl ?? originalUrl;
  const startingIds = useMemo(() => parseFacebookGroupPostLink(startingUrl), [startingUrl]);
  const originalPublishedAtLocal = useMemo(
    () => bangkokDateTime(post?.publishedAt ?? ''),
    [post?.publishedAt],
  );
  const companies = useMemo(() => sortCatalog(data.companies), [data.companies]);
  const companyOptions = useMemo(
    () => companies.map((item) => ({ value: item.id, en: item.name, th: item.name })),
    [companies],
  );
  const productsById = useMemo(
    () => new Map(data.products.map((item) => [item.id, item])),
    [data.products],
  );
  const allGroupsById = useMemo(
    () => new Map(data.groups.map((item) => [item.id, item])),
    [data.groups],
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const productInput = useRef<HTMLInputElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const keepEditingButton = useRef<HTMLButtonElement>(null);
  const discardButton = useRef<HTMLButtonElement>(null);
  const cancelDeleteButton = useRef<HTMLButtonElement>(null);
  const confirmDeleteButton = useRef<HTMLButtonElement>(null);
  const lastEditingFocus = useRef<HTMLElement | null>(null);
  const shouldRestoreEditingFocus = useRef(false);
  const savingRef = useRef(false);
  const [selectedCompany, setSelectedCompany] = useState(
    () => post?.companyId || (companyId !== 'all' ? companyId : '') || companies[0]?.id || '',
  );
  const [product, setProduct] = useState(() => {
    const linkedProduct = productsById.get(post?.productId ?? '');
    return (linkedProduct && !linkedProduct.deletedAt && linkedProduct.name) || post?.product || '';
  });
  const [initialGroupSelection] = useState(() => {
    const savedLinkedGroup = allGroupsById.get(post?.groupId ?? '');
    const linkedGroup =
      savedLinkedGroup && !savedLinkedGroup.deletedAt ? savedLinkedGroup : undefined;
    const ids = !post || post.platform === 'facebook' ? startingIds : null;
    if (
      linkedGroup &&
      (!initialUrl ||
        initialUrl.trim() === post?.url.trim() ||
        !ids ||
        groupMatchesFacebookKey(linkedGroup, ids.groupId))
    ) {
      return {
        groupId: linkedGroup.id,
        facebookGroupId: linkedGroup.facebookId,
        pendingGroup: null,
      };
    }
    const selectedGroup = ids
      ? resolvePostGroupSelection(data.groups, selectedCompany, ids.groupId)
      : null;
    if (selectedGroup) {
      return {
        groupId: selectedGroup.id,
        facebookGroupId: selectedGroup.facebookId,
        pendingGroup: data.groups.some((item) => item.id === selectedGroup.id)
          ? null
          : selectedGroup,
      };
    }
    return { groupId: post?.groupId ?? '', facebookGroupId: '', pendingGroup: null };
  });
  const [groupId, setGroupId] = useState(initialGroupSelection.groupId);
  const [pendingGroup, setPendingGroup] = useState<Group | null>(
    initialGroupSelection.pendingGroup,
  );
  const [facebookGroupId, setFacebookGroupId] = useState(initialGroupSelection.facebookGroupId);
  const [platform, setPlatform] = useState<Platform>(post?.platform ?? 'facebook');
  const [postType, setPostType] = useState<FacebookPostType>(
    post?.groupId || (post?.platform === 'facebook' && startingIds)
      ? 'group'
      : post
        ? 'page'
        : 'group',
  );
  const [initialPostType] = useState(postType);
  const [publicationStatus, setPublicationStatus] = useState<'published' | 'pending'>(() =>
    convertedStartingUrl ? 'pending' : post ? postPublicationStatus(post) : 'published',
  );
  const [publishedAt, setPublishedAt] = useState(() => originalPublishedAtLocal);
  const [facebookPostId, setFacebookPostId] = useState(
    startingIds?.postId ?? post?.facebookPostId ?? '',
  );
  const [url, setUrl] = useState(startingUrl);
  const [autoExtracted, setAutoExtracted] = useState<{
    groupId: string;
    postId: string;
    selectedGroupId: string;
    facebookGroupId: string;
  } | null>(
    startingIds
      ? {
          ...startingIds,
          selectedGroupId: initialGroupSelection.groupId,
          facebookGroupId: initialGroupSelection.facebookGroupId,
        }
      : null,
  );
  const [linkNotice, setLinkNotice] = useState('');
  const color = post?.color ?? '#4969d7';
  const [viewersInput, setViewersInput] = useState(
    post?.viewers === null || !post ? '' : String(post.viewers),
  );
  const [commentsInput, setCommentsInput] = useState(
    post?.commentCount == null ? '' : String(post.commentCount),
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [reviewTarget, setReviewTarget] = useState<{ post: Post; initialUrl?: string } | null>(
    null,
  );
  const currentSnapshot = postEditorSnapshot({
    companyId: selectedCompany,
    product,
    groupId,
    facebookGroupId,
    platform,
    postType,
    publicationStatus,
    publishedAt,
    facebookPostId,
    url,
    color,
    viewers: viewersInput,
    comments: commentsInput,
  });
  const [initialSnapshot] = useState(() =>
    postEditorSnapshot({
      companyId: selectedCompany,
      product,
      groupId,
      facebookGroupId,
      platform,
      postType,
      publicationStatus,
      publishedAt,
      facebookPostId: post?.facebookPostId ?? '',
      url: post?.url ?? '',
      color,
      viewers: viewersInput,
      comments: commentsInput,
    }),
  );
  const dirty = currentSnapshot !== initialSnapshot;
  const productCompanies = useMemo(
    () => productCompanyIdMap(data.products, data.posts),
    [data.products, data.posts],
  );
  const companyProducts = useMemo(
    () =>
      data.products.filter(
        (item) => !item.deletedAt && productCompanies.get(item.id)?.includes(selectedCompany),
      ),
    [data.products, productCompanies, selectedCompany],
  );
  const productsByName = useMemo(() => {
    const index = new Map<string, Workspace['products']>();
    for (const item of companyProducts) {
      const key = item.name.trim();
      const matches = index.get(key);
      if (matches) matches.push(item);
      else index.set(key, [item]);
    }
    return index;
  }, [companyProducts]);
  const productOptions = useMemo(
    () => sortCatalog(companyProducts).map((item) => <option key={item.id} value={item.name} />),
    [companyProducts],
  );
  const matchingProducts = productsByName.get(product.trim()) ?? [];
  const linkedProduct = productsById.get(post?.productId ?? '');
  const preserveProductId =
    post?.productId &&
    post.companyId === selectedCompany &&
    product.trim() === (linkedProduct?.name ?? post.product).trim();
  const groups = useMemo(
    () => data.groups.filter((item) => item.companyId === selectedCompany && !item.deletedAt),
    [data.groups, selectedCompany],
  );
  const scopedGroupsById = useMemo(() => new Map(groups.map((item) => [item.id, item])), [groups]);
  const group = pendingGroup?.id === groupId ? pendingGroup : scopedGroupsById.get(groupId);
  const matchedGroupName =
    pendingGroup &&
    (knownFacebookGroupName(pendingGroup.facebookId) ||
      knownFacebookGroupHandleName(groupFacebookKey(pendingGroup)));
  const normalizedUrl = normalizeFacebookGroupPostInput(url);
  const postUrl = convertFacebookPendingPostUrl(normalizedUrl) ?? normalizedUrl;
  const idsInUrl =
    platform === 'facebook' && postType === 'group' ? parseFacebookGroupPostLink(postUrl) : null;
  const namedGroupLink = !!idsInUrl && !/^\d{1,40}$/.test(idsInUrl.groupId);
  const candidatePublishedAt = useMemo(
    () =>
      post?.publishedAt && originalPublishedAtLocal === publishedAt
        ? post.publishedAt
        : toIso(publishedAt),
    [post?.publishedAt, originalPublishedAtLocal, publishedAt],
  );
  const candidate: Post = {
    id: post?.id || '',
    companyId: selectedCompany,
    groupId: platform === 'facebook' && postType === 'page' ? '' : groupId,
    product: product.trim(),
    ...(preserveProductId
      ? { productId: post.productId }
      : matchingProducts.length === 1
        ? { productId: matchingProducts[0].id }
        : {}),
    platform,
    publicationStatus,
    ...(post?.metaSourceRow ? { metaSourceRow: post.metaSourceRow } : {}),
    ...(post?.metaPublishedLabel ? { metaPublishedLabel: post.metaPublishedLabel } : {}),
    ...(post?.metaGroupName ? { metaGroupName: post.metaGroupName } : {}),
    ...(post?.metaGroupKey ? { metaGroupKey: post.metaGroupKey } : {}),
    ...(post?.destinationId &&
    post.companyId === selectedCompany &&
    post.platform === platform &&
    post.groupId === groupId &&
    postType === 'group'
      ? { destinationId: post.destinationId }
      : {}),
    publishedAt: candidatePublishedAt,
    facebookPostId: facebookPostId.trim(),
    url: postUrl,
    color,
    viewers: viewersInput.trim() === '' ? null : Number(viewersInput),
    commentCount: commentsInput.trim() === '' ? null : Number(commentsInput),
    pinned: post?.pinned === true,
  };
  const linkReview = useMemo(
    () => reviewPostLink(data, candidate, pendingGroup),
    [
      data,
      candidate.id,
      candidate.companyId,
      candidate.groupId,
      candidate.platform,
      candidate.facebookPostId,
      candidate.url,
      candidate.metaGroupKey,
      pendingGroup,
    ],
  );
  const generatedUrl =
    (platform === 'facebook' && postType === 'group'
      ? canonicalPostUrl(group?.facebookId ?? '', facebookPostId.trim())
      : '') || (safeUrl(postUrl) ? postUrl : '');
  const originalGroup = allGroupsById.get(post?.groupId ?? '');
  const legacyLinkedGroupWithoutId =
    !!post?.id &&
    !!originalGroup &&
    !originalGroup.facebookId &&
    groupId === post.groupId &&
    !pendingGroup;
  // Keep an existing link/group association editable without inferring a new numeric ID.
  const preservedNamedGroupLink =
    namedGroupLink &&
    !!post?.id &&
    postUrl === post.url.trim() &&
    selectedCompany === post.companyId &&
    groupId === post.groupId &&
    !pendingGroup;
  const existingWithoutLink =
    !!post?.id &&
    postType === initialPostType &&
    !post.url &&
    !canonicalPostUrl(originalGroup?.facebookId ?? '', post.facebookPostId);

  useLayoutEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (element && !element.open) element.showModal();
    (post?.id ? productInput.current : linkInput.current)?.focus({ preventScroll: true });
    return () => {
      if (element?.open) element.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (!dirty || saving || deleting) return;
    function protectUnsavedChanges(event: BeforeUnloadEvent) {
      if (savingRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', protectUnsavedChanges);
    return () => window.removeEventListener('beforeunload', protectUnsavedChanges);
  }, [dirty, saving, deleting]);

  useLayoutEffect(() => {
    if (confirmingDiscard) keepEditingButton.current?.focus();
    else if (confirmingDelete) cancelDeleteButton.current?.focus();
    else if (shouldRestoreEditingFocus.current) {
      (lastEditingFocus.current ?? (post?.id ? productInput.current : linkInput.current))?.focus();
      shouldRestoreEditingFocus.current = false;
    }
  }, [confirmingDiscard, confirmingDelete]);

  function requestClose() {
    if (savingRef.current || confirmingDiscard) return;
    if (confirmingDelete) {
      cancelDelete();
      return;
    }
    setReviewTarget(null);
    if (!dirty) {
      if (dialog.current?.open) dialog.current.close();
      onClose();
      return;
    }
    shouldRestoreEditingFocus.current = true;
    setConfirmingDiscard(true);
  }

  function keepEditing() {
    if (!savingRef.current) {
      setReviewTarget(null);
      setConfirmingDiscard(false);
    }
  }

  function discardChanges() {
    if (!savingRef.current) {
      if (dialog.current?.open) dialog.current.close();
      if (reviewTarget) onOpenPost(reviewTarget.post, reviewTarget.initialUrl);
      else onClose();
    }
  }

  function requestDelete() {
    if (!post?.id || savingRef.current || confirmingDiscard || confirmingDelete) return;
    shouldRestoreEditingFocus.current = true;
    setDeleteError('');
    setConfirmingDelete(true);
  }

  function cancelDelete() {
    if (savingRef.current) return;
    setDeleteError('');
    setConfirmingDelete(false);
  }

  function openExistingPost(target: Post, prefillLink?: string) {
    if (savingRef.current || confirmingDiscard) return;
    if (dirty) {
      setReviewTarget({ post: target, initialUrl: prefillLink });
      setConfirmingDiscard(true);
    } else {
      onOpenPost(target, prefillLink);
    }
  }

  function resetPostLink(message: string) {
    if (facebookPostId || url) setLinkNotice(message);
    setFacebookPostId('');
    setUrl('');
    setFacebookGroupId('');
    setPendingGroup(null);
    setAutoExtracted(null);
  }

  function selectGroupByFacebookKey(key: string): Group | null {
    const nextGroup = resolvePostGroupSelection(groups, selectedCompany, key, pendingGroup);
    if (!nextGroup) {
      setGroupId('');
      setPendingGroup(null);
      return null;
    }
    setPendingGroup(scopedGroupsById.has(nextGroup.id) ? null : nextGroup);
    setGroupId(nextGroup.id);
    return nextGroup;
  }

  function updateGroupId(value: string) {
    setFacebookGroupId(value);
    selectGroupByFacebookKey(/^\d{1,40}$/.test(value.trim()) ? value.trim() : '');
    setAutoExtracted(null);
    setLinkNotice('');
  }

  function updatePostType(value: FacebookPostType) {
    if (value === postType) return;
    setPostType(value);
    setError('');
    const hadGroupLink = !!parseFacebookGroupPostLink(url);
    const clearLink = value === 'group' || hadGroupLink;
    const hadLink = !!((clearLink && url) || facebookPostId || facebookGroupId || groupId);
    if (clearLink) setUrl('');
    setFacebookPostId('');
    setGroupId('');
    setFacebookGroupId('');
    setPendingGroup(null);
    setAutoExtracted(null);
    setLinkNotice(
      hadLink
        ? t(
            clearLink
              ? `Post type changed. The previous link and IDs were cleared. Add a ${value === 'group' ? 'Group' : 'Page'} post link.`
              : 'Post type changed. The Group IDs were cleared; please check the post link.',
            clearLink
              ? `เปลี่ยนประเภทโพสต์แล้ว ระบบล้างลิงก์และ ID เดิม กรุณาใส่ลิงก์โพสต์${value === 'group' ? 'ในกลุ่ม' : 'บนเพจ'}`
              : 'เปลี่ยนประเภทโพสต์แล้ว ระบบล้าง Group ID และ Post ID กรุณาตรวจสอบลิงก์โพสต์',
          )
        : '',
    );
  }

  function updatePostUrl(value: string) {
    const normalized = normalizeFacebookGroupPostInput(value);
    setUrl(normalized);
    setError('');
    setLinkNotice('');
    const converted = convertFacebookPendingPostUrl(normalized);
    if (converted) setPublicationStatus('pending');
    const ids = parseFacebookGroupPostLink(converted ?? normalized);
    if (ids) {
      setPlatform('facebook');
      setPostType('group');
      setFacebookPostId(ids.postId);
      const selectedGroup = selectGroupByFacebookKey(ids.groupId);
      if (!selectedGroup)
        setLinkNotice(
          t(
            'More than one saved group matches this link. Check the group records before saving.',
            'มีกลุ่มที่บันทึกไว้มากกว่าหนึ่งรายการตรงกับลิงก์นี้ กรุณาตรวจสอบรายการกลุ่มก่อนบันทึก',
          ),
        );
      const numericGroupId = selectedGroup?.facebookId ?? '';
      setFacebookGroupId(numericGroupId);
      setAutoExtracted({
        ...ids,
        selectedGroupId: selectedGroup?.id ?? '',
        facebookGroupId: numericGroupId,
      });
    } else if (autoExtracted) {
      if (facebookPostId === autoExtracted.postId) setFacebookPostId('');
      if (
        groupId === autoExtracted.selectedGroupId &&
        facebookGroupId === autoExtracted.facebookGroupId
      ) {
        setFacebookGroupId('');
        setGroupId('');
        setPendingGroup(null);
      }
      setAutoExtracted(null);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current || confirmingDiscard || confirmingDelete) return;
    setError('');
    if (publicationStatus === 'published' && !candidate.publishedAt)
      return setError(
        t(
          'Add a valid publication date for Published, or select Pending.',
          'ระบุวันที่เผยแพร่ที่ถูกต้องสำหรับสถานะเผยแพร่แล้ว หรือเลือกรอดำเนินการ',
        ),
      );
    if (publishedAt && !candidatePublishedAt)
      return setError(
        t(
          'Enter a valid publication date or leave it blank.',
          'กรุณาระบุวันที่เผยแพร่ที่ถูกต้อง หรือเว้นว่างไว้',
        ),
      );
    if (linkReview.exactMatch)
      return setError(
        t(
          'This link already belongs to another tracked post. Open that record instead.',
          'ลิงก์นี้เป็นของโพสต์ที่ติดตามอยู่แล้ว กรุณาเปิดรายการเดิมแทน',
        ),
      );
    if (!selectedCompany || !data.companies.some((item) => item.id === selectedCompany))
      return setError(t('Choose a company for this post.', 'เลือกบริษัทสำหรับโพสต์นี้'));
    if (candidate.groupId && !group)
      return setError(
        t('Choose an available group for this company.', 'เลือกกลุ่มที่ใช้งานได้สำหรับบริษัทนี้'),
      );
    if (platform === 'facebook' && postType === 'group') {
      const matchedNamedGroup =
        namedGroupLink && group && idsInUrl && groupMatchesFacebookKey(group, idsInUrl.groupId);
      if (!facebookGroupId.trim() && !legacyLinkedGroupWithoutId && !matchedNamedGroup)
        return setError(
          t(
            'Paste a Facebook group post link or enter its Group ID.',
            'วางลิงก์โพสต์ในกลุ่ม Facebook หรือระบุ Group ID',
          ),
        );
      if (facebookGroupId.trim() && !/^\d{1,40}$/.test(facebookGroupId.trim()))
        return setError(
          t('Group ID must contain 1–40 digits.', 'Group ID ต้องเป็นตัวเลข 1–40 หลัก'),
        );
      if (!group || (facebookGroupId.trim() && group.facebookId !== facebookGroupId.trim()))
        return setError(
          t(
            'The Group ID is not linked to this company. Enter it again.',
            'Group ID ยังไม่เชื่อมกับบริษัทนี้ กรุณาระบุใหม่',
          ),
        );
    }
    if (postUrl && !safeUrl(postUrl))
      return setError(
        t(
          'Use a valid link that starts with https://.',
          'ใช้ลิงก์ที่ถูกต้องและขึ้นต้นด้วย https://',
        ),
      );
    if (facebookPostId.trim() && !/^\d{1,40}$/.test(facebookPostId.trim()))
      return setError(
        t(
          'Facebook Post ID must contain 1–40 digits.',
          'Post ID ของ Facebook ต้องเป็นตัวเลข 1–40 หลัก',
        ),
      );
    if (platform === 'facebook' && postUrl) {
      const ids = parseFacebookGroupPostLink(postUrl);
      if (postType === 'page' && ids)
        return setError(
          t(
            'This is a Group post link. Select Group or add a Page post link.',
            'ลิงก์นี้เป็นโพสต์ในกลุ่ม เลือกกลุ่มหรือใส่ลิงก์โพสต์บนเพจ',
          ),
        );
      if (
        ids &&
        ((group && !groupMatchesFacebookKey(group, ids.groupId) && !preservedNamedGroupLink) ||
          (facebookPostId.trim() && ids.postId !== facebookPostId.trim()))
      )
        return setError(
          t(
            'The Facebook IDs do not match the pasted post URL.',
            'Facebook ID ไม่ตรงกับลิงก์โพสต์ที่วาง',
          ),
        );
    }
    if (Date.parse(candidate.publishedAt) > Date.now())
      return setError(
        t('Publication date cannot be in the future.', 'วันที่เผยแพร่ต้องไม่อยู่ในอนาคต'),
      );
    if (publicationStatus === 'published' && !generatedUrl && !existingWithoutLink)
      return setError(
        platform === 'facebook' && postType === 'group'
          ? t(
              'Add a Group post link, or enter Group ID and Post ID.',
              'เพิ่มลิงก์โพสต์ในกลุ่ม หรือระบุ Group ID และ Post ID',
            )
          : t('Add the published post URL.', 'เพิ่มลิงก์โพสต์ที่เผยแพร่'),
      );
    if (
      viewersInput.trim() !== '' &&
      (!/^\d+$/.test(viewersInput.trim()) || !Number.isSafeInteger(Number(viewersInput.trim())))
    )
      return setError(
        t(
          'Viewers must be a whole number of zero or more.',
          'จำนวนผู้ชมต้องเป็นจำนวนเต็มตั้งแต่ศูนย์ขึ้นไป',
        ),
      );
    if (
      commentsInput.trim() !== '' &&
      (!/^\d+$/.test(commentsInput.trim()) || !Number.isSafeInteger(Number(commentsInput.trim())))
    )
      return setError(
        t(
          'Comments must be a whole number of zero or more.',
          'จำนวนความคิดเห็นต้องเป็นจำนวนเต็มตั้งแต่ศูนย์ขึ้นไป',
        ),
      );
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave(
        {
          ...candidate,
          id: post?.id || crypto.randomUUID(),
        },
        platform === 'facebook' && postType === 'group' ? pendingGroup : null,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t(
              'This post could not be saved. Please try again.',
              'บันทึกโพสต์ไม่สำเร็จ กรุณาลองอีกครั้ง',
            ),
      );
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function deletePost() {
    if (!post?.id || savingRef.current || !confirmingDelete) return;
    savingRef.current = true;
    setDeleting(true);
    setDeleteError('');
    try {
      // Delete the saved record, without submitting unsaved form fields or a pending group.
      if (await onDelete(post)) {
        onClose();
        return;
      }
      setDeleteError(
        t(
          'Could not move this post to Trash. Your edits are still here. Please try again.',
          'ย้ายโพสต์ไปถังขยะไม่สำเร็จ การแก้ไขของคุณยังอยู่ที่นี่ กรุณาลองอีกครั้ง',
        ),
      );
    } catch {
      setDeleteError(
        t(
          'Could not move this post to Trash. Please try again.',
          'ย้ายโพสต์ไปถังขยะไม่สำเร็จ กรุณาลองอีกครั้ง',
        ),
      );
    }
    savingRef.current = false;
    setDeleting(false);
  }

  return (
    <dialog
      ref={dialog}
      className={`${styles.dialog} ${confirmingDiscard || confirmingDelete ? styles.confirmingDialog : ''}`}
      role={confirmingDiscard || confirmingDelete ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      aria-labelledby={
        confirmingDiscard
          ? 'discard-changes-title'
          : confirmingDelete
            ? 'confirm-delete-title'
            : 'post-editor-title'
      }
      aria-describedby={
        confirmingDiscard
          ? 'discard-changes-description'
          : confirmingDelete
            ? 'confirm-delete-description'
            : undefined
      }
      aria-busy={saving || deleting || undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (confirmingDiscard) keepEditing();
        else if (confirmingDelete) cancelDelete();
        else requestClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || deleting) return;
        const firstButton = confirmingDelete
          ? cancelDeleteButton.current
          : confirmingDiscard
            ? keepEditingButton.current
            : null;
        const lastButton = confirmingDelete
          ? confirmDeleteButton.current
          : confirmingDiscard
            ? discardButton.current
            : null;
        if (!firstButton || !lastButton) return;
        if (event.shiftKey && document.activeElement === firstButton) {
          event.preventDefault();
          lastButton.focus();
        } else if (!event.shiftKey && document.activeElement === lastButton) {
          event.preventDefault();
          firstButton.focus();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            requestClose();
        }
      }}
    >
      <div
        className={styles.editingContent}
        hidden={confirmingDiscard || confirmingDelete}
        onFocusCapture={(event) => {
          lastEditingFocus.current = event.target as HTMLElement;
        }}
      >
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>
              {publicationStatus === 'pending'
                ? t('PENDING POST', 'โพสต์ที่รอดำเนินการ')
                : t('PUBLISHED POST', 'โพสต์ที่เผยแพร่แล้ว')}
            </span>
            <h2 id="post-editor-title">
              {post?.id
                ? t('Edit tracked post', 'แก้ไขโพสต์ที่ติดตาม')
                : t('Add post', 'เพิ่มโพสต์')}
            </h2>
            <p>
              {post?.metaSourceRow
                ? t(
                    'Add missing details when available. Meta row details are kept below.',
                    'เพิ่มข้อมูลที่ยังไม่ทราบภายหลังได้ และดูข้อมูลจากแถว Meta ด้านล่าง',
                  )
                : t(
                    'Record the link, actual publication date, and Viewers.',
                    'บันทึกลิงก์ วันที่เผยแพร่จริง และยอดผู้ชม',
                  )}
            </p>
          </div>
          <button
            className={styles.iconButton}
            type="button"
            aria-label={t('Close editor', 'ปิดหน้าต่างแก้ไข')}
            onClick={requestClose}
            disabled={saving || deleting}
          >
            <X size={22} />
          </button>
        </header>
        <form ref={form} onSubmit={submit} className={styles.form}>
          <div className={styles.body}>
            <div className={styles.fields}>
              <div className={styles.pair}>
                <SelectionField
                  label={t('Company', 'บริษัท')}
                  value={selectedCompany}
                  options={companyOptions}
                  t={t}
                  onSelect={(value) => {
                    setSelectedCompany(value);
                    setGroupId('');
                    resetPostLink(
                      t(
                        'Company changed. The previous group, Post ID, and link were cleared. Add the details for this company.',
                        'เปลี่ยนบริษัทแล้ว ระบบล้างกลุ่ม Post ID และลิงก์เดิม กรุณาระบุข้อมูลสำหรับบริษัทนี้',
                      ),
                    );
                  }}
                />
                <SelectionField
                  label={t('Platform', 'แพลตฟอร์ม')}
                  value={platform}
                  options={
                    [
                      { value: 'facebook', en: 'Facebook', th: 'Facebook' },
                      { value: 'instagram', en: 'Instagram', th: 'Instagram' },
                      { value: 'tiktok', en: 'TikTok', th: 'TikTok' },
                      { value: 'linkedin', en: 'LinkedIn', th: 'LinkedIn' },
                    ] as const
                  }
                  t={t}
                  onSelect={(value) => {
                    setPlatform(value);
                    setGroupId('');
                    resetPostLink(
                      t(
                        'Platform changed. The previous Post ID and link were cleared. Add the link for this platform.',
                        'เปลี่ยนแพลตฟอร์มแล้ว ระบบล้าง Post ID และลิงก์เดิม กรุณาเพิ่มลิงก์สำหรับแพลตฟอร์มนี้',
                      ),
                    );
                  }}
                />
              </div>
              <div className={platform === 'facebook' ? styles.pair : undefined}>
                <SelectionField
                  label={t('Post status', 'สถานะโพสต์')}
                  value={publicationStatus}
                  options={
                    [
                      { value: 'published', en: 'Published', th: 'เผยแพร่แล้ว' },
                      { value: 'pending', en: 'Pending', th: 'รอดำเนินการ' },
                    ] as const
                  }
                  t={t}
                  onSelect={setPublicationStatus}
                />
                {platform === 'facebook' && (
                  <SelectionField
                    label={t('Post type', 'ประเภทโพสต์')}
                    value={postType}
                    options={
                      [
                        { value: 'group', en: 'Group', th: 'กลุ่ม' },
                        { value: 'page', en: 'Page', th: 'เพจ' },
                      ] as const
                    }
                    t={t}
                    onSelect={updatePostType}
                  />
                )}
              </div>
              {platform === 'facebook' && (
                <p className={`${styles.helper} ${styles.postTypeHint}`}>
                  {postType === 'group'
                    ? t(
                        'Paste a Group post URL to detect the group and Post ID, or enter numeric IDs below.',
                        'วางลิงก์โพสต์ในกลุ่มเพื่อตรวจจับกลุ่มและ Post ID หรือระบุ ID แบบตัวเลขด้านล่าง',
                      )
                    : publicationStatus === 'pending'
                      ? t(
                          'Add the Facebook Page post URL when available.',
                          'เพิ่มลิงก์โพสต์บนเพจ Facebook เมื่อมีข้อมูล',
                        )
                      : t(
                          'Add the published Facebook Page post URL.',
                          'เพิ่มลิงก์โพสต์บนเพจ Facebook ที่เผยแพร่แล้ว',
                        )}
                </p>
              )}
              {post?.metaSourceRow && (
                <div className={styles.metaSourceNote}>
                  <div className={styles.metaSourceHeading}>
                    <span>
                      {t(`Meta row ${post.metaSourceRow}`, `แถว Meta ${post.metaSourceRow}`)}
                    </span>
                    {publicationStatus === 'pending' && (
                      <span className={styles.pendingBadge}>{t('Pending', 'รอดำเนินการ')}</span>
                    )}
                  </div>
                  <p>
                    {publicationStatus === 'pending'
                      ? t(
                          publishedAt
                            ? 'The saved publication date stays on this Pending post. Select Published when its status is confirmed.'
                            : 'Select Published and add the confirmed publication date when available.',
                          publishedAt
                            ? 'วันที่เผยแพร่ที่บันทึกไว้ยังคงอยู่กับโพสต์ที่รอดำเนินการ เลือกเผยแพร่แล้วเมื่อยืนยันสถานะแล้ว'
                            : 'เลือกเผยแพร่แล้วและระบุวันที่เผยแพร่ที่ยืนยันแล้วเมื่อมีข้อมูล',
                        )
                      : post.metaPublishedLabel && !publishedAt
                        ? t(
                            `Meta showed “${post.metaPublishedLabel}” without a full date. Add the year when known.`,
                            `Meta แสดง “${post.metaPublishedLabel}” โดยไม่มีวันที่ครบถ้วน เพิ่มปีเมื่อทราบ`,
                          )
                        : t(
                            'Keep the original Meta row as a reference while completing this post.',
                            'ใช้แถว Meta เดิมเป็นข้อมูลอ้างอิงระหว่างเติมรายละเอียดโพสต์',
                          )}
                  </p>
                  {post.metaGroupKey && (
                    <p className={styles.metaGroupKey}>
                      {t('Group ID / slug', 'Group ID / ชื่อย่อ')}: {post.metaGroupKey}
                    </p>
                  )}
                </div>
              )}
              <label>
                {t('Product / campaign', 'สินค้า / แคมเปญ')}
                <input
                  ref={productInput}
                  list="post-product-catalog"
                  value={product}
                  onChange={(event) => setProduct(event.target.value)}
                  maxLength={200}
                  placeholder={t('e.g. New collection', 'เช่น คอลเลกชันใหม่')}
                />
                <datalist id="post-product-catalog">{productOptions}</datalist>
              </label>
              <div className={styles.dateFields}>
                <CalendarField
                  label={t('Published on', 'วันที่เผยแพร่')}
                  type="datetime-local"
                  value={publishedAt}
                  required={publicationStatus === 'published'}
                  max={bangkokDateTime(new Date().toISOString())}
                  describedBy="post-publication-hint"
                  onChange={setPublishedAt}
                  t={t}
                  disabled={saving || deleting}
                />
                <p className={styles.helper} id="post-publication-hint">
                  <CalendarDays size={16} />
                  {publicationStatus === 'pending'
                    ? t(
                        'Optional for Pending. A saved publication date stays on this post when its status changes.',
                        'ไม่จำเป็นสำหรับสถานะรอดำเนินการ วันที่เผยแพร่ที่บันทึกไว้จะยังคงอยู่เมื่อเปลี่ยนสถานะโพสต์',
                      )
                    : t(
                        'Required for Published · Actual publication time in Bangkok (UTC+7).',
                        'จำเป็นสำหรับสถานะเผยแพร่แล้ว · เวลาที่เผยแพร่จริงในกรุงเทพฯ (UTC+7)',
                      )}
                </p>
              </div>
              <section className={styles.section} aria-labelledby="post-link-title">
                <h3 id="post-link-title">
                  <Link2 size={18} />
                  {t('Post link', 'ลิงก์โพสต์')}
                </h3>
                {linkNotice && (
                  <p className={styles.linkNotice} role="status">
                    {linkNotice}
                  </p>
                )}
                {existingWithoutLink && (
                  <p className={styles.helper}>
                    {t(
                      'Post link: Null. Add it when available; you can still save this record.',
                      'ลิงก์โพสต์: Null เพิ่มได้เมื่อมีข้อมูล และยังบันทึกรายการนี้ได้',
                    )}
                  </p>
                )}
                <label>
                  {publicationStatus === 'pending'
                    ? t('Post URL (when available)', 'ลิงก์โพสต์ (เมื่อมี)')
                    : t('Published post URL', 'ลิงก์โพสต์ที่เผยแพร่')}
                  <input
                    ref={linkInput}
                    type="url"
                    value={url}
                    onChange={(event) => updatePostUrl(event.target.value)}
                    onPaste={(event) => {
                      const converted = convertFacebookPendingPostUrl(
                        event.clipboardData.getData('text'),
                      );
                      if (!converted) return;
                      event.preventDefault();
                      updatePostUrl(converted);
                      setPublicationStatus('pending');
                    }}
                    onBlur={() => {
                      const converted = convertFacebookPendingPostUrl(url);
                      if (converted) setUrl(converted);
                    }}
                    placeholder="https://"
                    maxLength={2048}
                    required={
                      publicationStatus === 'published' &&
                      !existingWithoutLink &&
                      !(
                        platform === 'facebook' &&
                        postType === 'group' &&
                        canonicalPostUrl(group?.facebookId ?? '', facebookPostId.trim())
                      )
                    }
                  />
                </label>
                {idsInUrl && (
                  <div className={styles.detectedIds} role="status">
                    <Check size={16} aria-hidden="true" />
                    <span>
                      {namedGroupLink
                        ? t('Group handle', 'ชื่อย่อกลุ่ม')
                        : t('Group ID', 'Group ID')}{' '}
                      <strong>{idsInUrl.groupId}</strong>
                    </span>
                    <span>
                      {t('Post ID', 'Post ID')} <strong>{idsInUrl.postId}</strong>
                    </span>
                    {group && (
                      <small>
                        {pendingGroup?.id === groupId
                          ? matchedGroupName
                            ? t(
                                `Matched your group list: ${matchedGroupName}`,
                                `พบชื่อกลุ่มจากรายการ: ${matchedGroupName}`,
                              )
                            : t(
                                `New group will be saved as “${pendingGroup.name}”. Rename it in Groups later.`,
                                `จะบันทึกกลุ่มใหม่ชื่อ “${pendingGroup.name}” เปลี่ยนชื่อได้ในหน้ากลุ่มภายหลัง`,
                              )
                          : t(`Saved group: ${group.name}`, `กลุ่มที่บันทึกไว้: ${group.name}`)}
                      </small>
                    )}
                  </div>
                )}
                {linkReview.exactMatch && (
                  <div className={`${styles.linkReview} ${styles.exactLinkMatch}`} role="alert">
                    <div className={styles.linkReviewHeading}>
                      <TriangleAlert size={18} aria-hidden="true" />
                      <strong>
                        {t('This post is already tracked', 'โพสต์นี้ถูกติดตามอยู่แล้ว')}
                      </strong>
                    </div>
                    <p>
                      {t(
                        'This link or Post ID belongs to an existing record. Open it to edit the company or product.',
                        'ลิงก์หรือ Post ID นี้เป็นของรายการเดิม เปิดรายการนั้นเพื่อแก้ไขบริษัทหรือสินค้า',
                      )}
                    </p>
                    <span className={styles.linkReviewDetail}>
                      {linkReview.exactMatch.product || 'Null'}
                      {linkReview.exactMatch.metaSourceRow
                        ? ` · ${t(`Meta row ${linkReview.exactMatch.metaSourceRow}`, `แถว Meta ${linkReview.exactMatch.metaSourceRow}`)}`
                        : ''}
                    </span>
                    <button
                      type="button"
                      className={styles.reviewPostButton}
                      onClick={() => openExistingPost(linkReview.exactMatch!)}
                    >
                      {t('Open existing record', 'เปิดรายการเดิม')}
                    </button>
                  </div>
                )}
                {!linkReview.exactMatch && linkReview.possibleMetaRows.length > 0 && (
                  <div className={styles.linkReview} role="status">
                    <div className={styles.linkReviewHeading}>
                      <TriangleAlert size={18} aria-hidden="true" />
                      <strong>
                        {t(
                          'Check existing Meta rows in this group',
                          'ตรวจสอบแถว Meta ที่มีอยู่ในกลุ่มนี้',
                        )}
                      </strong>
                    </div>
                    <p>
                      {t(
                        'A group may have several posts. If this link belongs to one of these rows, open it with the link filled in, review, then save.',
                        'หนึ่งกลุ่มอาจมีหลายโพสต์ หากลิงก์นี้เป็นของแถวใด ให้เปิดแถวนั้นโดยระบบจะใส่ลิงก์ให้ ตรวจสอบแล้วจึงบันทึก',
                      )}
                    </p>
                    <ul className={styles.possibleMetaRows}>
                      {linkReview.possibleMetaRows.map((row) => (
                        <li key={row.id}>
                          <span>
                            <strong>
                              {t(`Meta row ${row.metaSourceRow}`, `แถว Meta ${row.metaSourceRow}`)}
                            </strong>
                            <small>
                              {postPublicationStatus(row) === 'pending'
                                ? t('Pending', 'รอดำเนินการ')
                                : t('Published', 'เผยแพร่แล้ว')}{' '}
                              · {row.metaPublishedLabel || t('Date: Null', 'วันที่: Null')} ·{' '}
                              {row.viewers === null ? 'Null' : row.viewers} {t('Viewers', 'ผู้ชม')}
                            </small>
                          </span>
                          <button
                            type="button"
                            className={styles.reviewPostButton}
                            onClick={() => openExistingPost(row, generatedUrl)}
                          >
                            {t('Use this row', 'ใช้แถวนี้')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {platform === 'facebook' && postType === 'group' && (
                  <div className={styles.facebookIds}>
                    <p className={styles.facebookIdsTitle}>{t('Facebook IDs', 'Facebook ID')}</p>
                    <div className={styles.pair}>
                      <label>
                        {t('Group ID', 'Group ID')}
                        <input
                          value={facebookGroupId}
                          type="text"
                          inputMode="numeric"
                          onChange={(event) => updateGroupId(event.target.value)}
                          placeholder={
                            namedGroupLink
                              ? t('Not included in this link', 'ไม่มีในลิงก์นี้')
                              : '878540877111439'
                          }
                          maxLength={100}
                        />
                      </label>
                      <label>
                        {t('Post ID', 'Post ID')}
                        <input
                          value={facebookPostId}
                          type="text"
                          inputMode="numeric"
                          onChange={(event) => setFacebookPostId(event.target.value)}
                          placeholder="123456789012345"
                          maxLength={100}
                        />
                      </label>
                    </div>
                    {namedGroupLink && !facebookGroupId && (
                      <p className={styles.helper}>
                        {t(
                          'This link uses a group handle. Its numeric Group ID is not included and is not required.',
                          'ลิงก์นี้ใช้ชื่อย่อกลุ่ม ไม่มี Group ID แบบตัวเลขในลิงก์และไม่จำเป็นต้องระบุ',
                        )}
                      </p>
                    )}
                  </div>
                )}
                {platform === 'facebook' && postType === 'group' && !idsInUrl && group && (
                  <p className={styles.groupIdentity} role="status">
                    {pendingGroup?.id === groupId
                      ? matchedGroupName
                        ? t(
                            `Matched your group list: ${matchedGroupName}`,
                            `พบชื่อกลุ่มจากรายการ: ${matchedGroupName}`,
                          )
                        : t(
                            `New group will be saved as “${pendingGroup.name}”. Rename it in Groups later.`,
                            `จะบันทึกกลุ่มใหม่ชื่อ “${pendingGroup.name}” เปลี่ยนชื่อได้ในหน้ากลุ่มภายหลัง`,
                          )
                      : t(`Saved group: ${group.name}`, `กลุ่มที่บันทึกไว้: ${group.name}`)}
                  </p>
                )}
                {!!generatedUrl && (
                  <a
                    className={styles.generatedLink}
                    href={generatedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>{generatedUrl}</span>
                    <ArrowUpRight size={17} />
                  </a>
                )}
              </section>
              <section className={styles.section} aria-labelledby="metrics-title">
                <div className={styles.sectionHeader}>
                  <h3 id="metrics-title">
                    <Eye size={18} />
                    {t('Current post totals', 'ยอดล่าสุดของโพสต์')}
                  </h3>
                </div>
                <p className={styles.helper}>
                  {publicationStatus === 'pending'
                    ? t(
                        'Pending posts are excluded from published performance, even when a publication date is saved.',
                        'โพสต์ที่รอดำเนินการจะไม่นับรวมในผลลัพธ์ของโพสต์ที่เผยแพร่แล้ว แม้มีวันที่เผยแพร่ที่บันทึกไว้',
                      )
                    : t(
                        'Enter the latest totals shown on the post. Leave a field blank when it is unknown.',
                        'ใส่ยอดล่าสุดที่แสดงบนโพสต์ เว้นว่างไว้หากยังไม่ทราบยอด',
                      )}
                </p>
                <div className={styles.pair}>
                  <label>
                    {t('Total Viewers', 'ผู้ชมสะสม')}
                    <input
                      type="text"
                      inputMode="numeric"
                      value={viewersInput}
                      onChange={(event) => setViewersInput(event.target.value)}
                      placeholder={t('Unknown', 'ยังไม่ทราบ')}
                    />
                  </label>
                  <label>
                    <span className={styles.metricLabel}>
                      <MessageCircle size={16} aria-hidden="true" />
                      {t('Comments', 'ความคิดเห็น')}
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={commentsInput}
                      onChange={(event) => setCommentsInput(event.target.value)}
                      placeholder={t('Unknown', 'ยังไม่ทราบ')}
                    />
                  </label>
                </div>
              </section>
            </div>
          </div>
          <footer className={styles.footer}>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <div className={styles.footerActions}>
              {post?.id ? (
                <button
                  type="button"
                  className={styles.deleteButton}
                  onClick={requestDelete}
                  disabled={saving || deleting}
                  title={t('Recover from Trash for 30 days', 'กู้คืนจากถังขยะได้ภายใน 30 วัน')}
                >
                  {deleting ? t('Deleting…', 'กำลังลบ…') : t('Delete post', 'ลบโพสต์')}
                </button>
              ) : (
                <span>{t('Stored in this browser', 'จัดเก็บในเบราว์เซอร์นี้')}</span>
              )}
              <button
                type="button"
                className={styles.cancelButton}
                onClick={requestClose}
                disabled={saving || deleting}
              >
                {t('Cancel', 'ยกเลิก')}
              </button>
              <button
                type="submit"
                disabled={saving || deleting || Boolean(linkReview.exactMatch)}
                className={`${styles.saveButton} ${linkReview.exactMatch ? styles.duplicateDisabled : ''}`}
              >
                <Check size={18} />
                {saving
                  ? t('Saving…', 'กำลังบันทึก…')
                  : t('Save tracked post', 'บันทึกโพสต์ที่ติดตาม')}
              </button>
            </div>
          </footer>
        </form>
      </div>
      {confirmingDiscard && (
        <section className={styles.discardPanel}>
          <div className={styles.discardIcon} aria-hidden="true">
            <TriangleAlert size={26} />
          </div>
          <span className={styles.eyebrow}>
            {t('UNSAVED CHANGES', 'มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก')}
          </span>
          <h2 id="discard-changes-title">
            {reviewTarget
              ? t('Open the existing record?', 'เปิดรายการเดิมหรือไม่?')
              : t('Keep these changes?', 'เก็บการเปลี่ยนแปลงนี้ไว้ไหม?')}
          </h2>
          <p id="discard-changes-description">
            {reviewTarget
              ? t(
                  'Your changes here are not saved. Discard them to open the existing record, or keep editing this one.',
                  'การแก้ไขรายการนี้ยังไม่ถูกบันทึก ทิ้งการแก้ไขเพื่อเปิดรายการเดิม หรือแก้ไขรายการนี้ต่อ',
                )
              : t(
                  'Your changes have not been saved. Keep editing to save them, or discard these changes and close the editor.',
                  'การเปลี่ยนแปลงของคุณยังไม่ได้บันทึก เลือกแก้ไขต่อเพื่อบันทึก หรือทิ้งการเปลี่ยนแปลงและปิดหน้าต่างนี้',
                )}
          </p>
          <div className={styles.discardActions}>
            <button
              ref={keepEditingButton}
              type="button"
              className={styles.saveButton}
              onClick={keepEditing}
            >
              {t('Keep editing', 'แก้ไขต่อ')}
            </button>
            <button
              ref={discardButton}
              type="button"
              className={styles.discardButton}
              onClick={discardChanges}
            >
              {reviewTarget
                ? t('Discard and open', 'ทิ้งแล้วเปิดรายการเดิม')
                : t('Discard changes', 'ทิ้งการเปลี่ยนแปลง')}
            </button>
          </div>
        </section>
      )}
      {confirmingDelete && (
        <section className={styles.discardPanel}>
          <div className={`${styles.discardIcon} ${styles.deleteIcon}`} aria-hidden="true">
            <Trash2 size={26} />
          </div>
          <span className={`${styles.eyebrow} ${styles.dangerEyebrow}`}>
            {t('MOVE TO TRASH', 'ย้ายไปถังขยะ')}
          </span>
          <h2 id="confirm-delete-title">
            {t('Move this post to Trash?', 'ย้ายโพสต์นี้ไปถังขยะหรือไม่?')}
          </h2>
          <p id="confirm-delete-description">
            {dirty
              ? t(
                  'You can restore it within 30 days. Your unsaved edits will be lost.',
                  'คุณกู้คืนโพสต์ได้ภายใน 30 วัน แต่การแก้ไขที่ยังไม่บันทึกจะหายไป',
                )
              : t(
                  'You can restore it from Trash within 30 days.',
                  'คุณกู้คืนโพสต์จากถังขยะได้ภายใน 30 วัน',
                )}
          </p>
          {deleteError && (
            <p role="alert" className={styles.deleteError}>
              {deleteError}
            </p>
          )}
          <div className={styles.discardActions}>
            <button
              ref={cancelDeleteButton}
              type="button"
              className={styles.cancelButton}
              onClick={cancelDelete}
              disabled={deleting}
            >
              {t('Cancel', 'ยกเลิก')}
            </button>
            <button
              ref={confirmDeleteButton}
              type="button"
              className={styles.confirmDeleteButton}
              onClick={deletePost}
              disabled={deleting}
            >
              {deleting ? t('Moving…', 'กำลังย้าย…') : t('Move to Trash', 'ย้ายไปถังขยะ')}
            </button>
          </div>
        </section>
      )}
    </dialog>
  );
}
