'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { Group, Post, Translate, Workspace } from '@/lib/types';
import PostEditor from './PostEditor';

export type PostEditorControlHandle = {
  open: (post: Post | null) => void;
  close: () => void;
  currentPost: () => Post | null | undefined;
};

type Props = {
  data: Workspace;
  companyId: string;
  t: Translate;
  onSave: (post: Post, pendingGroup: Group | null) => Promise<void>;
  onDelete: (post: Post) => Promise<boolean>;
};

const PostEditorControl = forwardRef<PostEditorControlHandle, Props>(function PostEditorControl(
  { data, companyId, t, onSave, onDelete },
  ref,
) {
  const activePost = useRef<Post | null | undefined>(undefined);
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [prefillUrl, setPrefillUrl] = useState('');

  function close() {
    activePost.current = undefined;
    setPost(undefined);
    setPrefillUrl('');
  }

  useImperativeHandle(ref, () => ({
    open(nextPost) {
      activePost.current = nextPost;
      setPost(nextPost);
      setPrefillUrl('');
    },
    close,
    currentPost: () => activePost.current,
  }));

  return post === undefined ? null : (
    <PostEditor
      key={`${post?.id ?? 'new'}:${prefillUrl}`}
      post={post}
      initialUrl={prefillUrl || undefined}
      data={data}
      companyId={companyId}
      t={t}
      onSave={onSave}
      onDelete={onDelete}
      onClose={close}
      onOpenPost={(nextPost, initialUrl) => {
        activePost.current = nextPost;
        setPost(nextPost);
        setPrefillUrl(initialUrl ?? '');
      }}
    />
  );
});

export default PostEditorControl;
