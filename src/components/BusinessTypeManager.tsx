'use client';

import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, Check, Plus, RotateCcw, Settings2, Trash2, X } from 'lucide-react';
import { nextSortOrder, sortCatalog } from '@/lib/catalog';
import { validateWorkspace } from '@/lib/data';
import { entityEditIsCurrent } from '@/lib/entity-edit';
import type { BusinessType, Translate, Workspace } from '@/lib/types';
import s from './BusinessTypeManager.module.css';
import p from './PostEditor.module.css';
import SelectionField from './SelectionField';

interface Props {
  data: Workspace;
  update: (next: Workspace) => Promise<boolean>;
  t: Translate;
  notify: (message: string) => void;
  onClose: () => void;
}
type Field = BusinessType['customerFields'][number];
type Section = BusinessType['customerSections'][number];

export default function BusinessTypeManager({ data, update, t, notify, onClose }: Props) {
  const [draft, setDraft] = useState<BusinessType | null>(null);
  const [baseline, setBaseline] = useState<BusinessType | null>(null);
  const [draftSnapshot, setDraftSnapshot] = useState('');
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const discardRef = useRef<HTMLButtonElement>(null);
  const previousEditFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const discardTitleId = useId();
  const discardDescriptionId = useId();
  const dirty = !!draft && JSON.stringify(draft) !== draftSnapshot;
  const sections: { id: Section; en: string; th: string; detailEn: string; detailTh: string }[] = [
    {
      id: 'social',
      en: 'Social links',
      th: 'ลิงก์โซเชียล',
      detailEn: 'Labeled social media and chat links',
      detailTh: 'ลิงก์โซเชียลมีเดียและแชตพร้อมชื่อกำกับ',
    },
    {
      id: 'domains',
      en: 'Domains',
      th: 'โดเมน',
      detailEn: 'Domain names and expiry dates',
      detailTh: 'ชื่อโดเมนและวันหมดอายุ',
    },
    {
      id: 'github',
      en: 'GitHub accounts',
      th: 'บัญชี GitHub',
      detailEn: 'Account names, usernames, and email addresses',
      detailTh: 'ชื่อบัญชี ชื่อผู้ใช้ และอีเมล',
    },
  ];
  const fieldTypes: { id: Field['type']; en: string; th: string }[] = [
    { id: 'text', en: 'Text', th: 'ข้อความ' },
    { id: 'textarea', en: 'Long text', th: 'ข้อความยาว' },
    { id: 'email', en: 'Email', th: 'อีเมล' },
    { id: 'url', en: 'HTTPS link', th: 'ลิงก์ HTTPS' },
    { id: 'date', en: 'Date', th: 'วันที่' },
  ];

  useLayoutEffect(() => {
    const element = dialogRef.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (element && !element.open) element.showModal();
    addRef.current?.focus({ preventScroll: true });
    return () => {
      if (element?.open) element.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    if (pendingDiscard) keepEditingRef.current?.focus({ preventScroll: true });
  }, [pendingDiscard]);

  function runOrConfirm(action: () => void) {
    if (busyRef.current || pendingDiscard) return;
    if (dirty) {
      previousEditFocus.current = document.activeElement as HTMLElement | null;
      setPendingDiscard(() => action);
    } else action();
  }
  function dismiss() {
    runOrConfirm(() => {
      dialogRef.current?.close();
      onClose();
    });
  }
  function applyEdit(type?: BusinessType) {
    setBaseline(type ? structuredClone(type) : null);
    const next: BusinessType = type
      ? structuredClone(type)
      : {
          id: crypto.randomUUID(),
          name: '',
          customerSections: ['social'],
          customerFields: [],
          sortOrder: nextSortOrder(data.businessTypes),
        };
    setDraft(next);
    setDraftSnapshot(JSON.stringify(next));
    setError('');
    requestAnimationFrame(() => nameRef.current?.focus({ preventScroll: true }));
  }
  function edit(type?: BusinessType) {
    runOrConfirm(() => applyEdit(type));
  }
  function keepEditing() {
    setPendingDiscard(null);
    requestAnimationFrame(() => {
      const target = previousEditFocus.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
      else nameRef.current?.focus({ preventScroll: true });
    });
  }
  function patchField(id: string, change: Partial<Field>) {
    if (!draft) return;
    setDraft({
      ...draft,
      customerFields: draft.customerFields.map((field) =>
        field.id === id ? { ...field, ...change } : field,
      ),
    });
  }
  function removeField(field: Field) {
    if (!draft) return;
    const existing = baseline?.customerFields.some((item) => item.id === field.id);
    setDraft({
      ...draft,
      customerFields: existing
        ? draft.customerFields.map((item) =>
            item.id === field.id ? { ...item, archived: true } : item,
          )
        : draft.customerFields.filter((item) => item.id !== field.id),
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || busyRef.current || pendingDiscard) return;
    const current = data.businessTypes.find((type) => type.id === draft.id);
    if (!entityEditIsCurrent(baseline, current)) {
      setError(
        t(
          'This business type changed in another tab. Reopen it before saving.',
          'ประเภทธุรกิจนี้ถูกแก้ไขในแท็บอื่น โปรดเปิดข้อมูลล่าสุดก่อนบันทึก',
        ),
      );
      return;
    }
    if (!draft.name.trim() || draft.customerFields.some((field) => !field.label.trim())) {
      setError(
        t(
          'Enter a business type name and a label for every field.',
          'กรอกชื่อประเภทธุรกิจและชื่อกำกับของทุกช่องข้อมูล',
        ),
      );
      return;
    }
    const type: BusinessType = {
      ...draft,
      name: draft.name.trim(),
      customerFields: draft.customerFields.map((field) => ({
        ...field,
        label: field.label.trim(),
      })),
    };
    const next = {
      ...data,
      businessTypes: current
        ? data.businessTypes.map((item) => (item.id === type.id ? type : item))
        : [...data.businessTypes, type],
    };
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      validateWorkspace(next);
      if (!(await update(next))) {
        setError(
          t(
            'Could not save. Your changes are still here. Review the workspace message and try again.',
            'บันทึกไม่สำเร็จ การแก้ไขของคุณยังอยู่ โปรดตรวจสอบข้อความพื้นที่ทำงานแล้วลองอีกครั้ง',
          ),
        );
        return;
      }
      setDraft(null);
      setBaseline(null);
      setDraftSnapshot('');
      notify(t('Business type saved.', 'บันทึกประเภทธุรกิจแล้ว'));
      requestAnimationFrame(() => addRef.current?.focus());
    } catch {
      setError(
        t(
          'Could not save this business type. Check the fields and try again.',
          'บันทึกประเภทธุรกิจไม่สำเร็จ ตรวจสอบข้อมูลแล้วลองอีกครั้ง',
        ),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={`${p.dialog} ${s.dialog} ${pendingDiscard ? p.confirmingDialog : ''}`}
      role={pendingDiscard ? 'alertdialog' : 'dialog'}
      aria-labelledby={pendingDiscard ? discardTitleId : titleId}
      aria-describedby={pendingDiscard ? discardDescriptionId : descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (pendingDiscard) keepEditing();
        else dismiss();
      }}
      onKeyDown={(event) => {
        if (!pendingDiscard || event.key !== 'Tab') return;
        if (event.shiftKey && document.activeElement === keepEditingRef.current) {
          event.preventDefault();
          discardRef.current?.focus();
        } else if (!event.shiftKey && document.activeElement === discardRef.current) {
          event.preventDefault();
          keepEditingRef.current?.focus();
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          dismiss();
      }}
    >
      <div className={s.editingContent} hidden={!!pendingDiscard}>
        <header className={s.header}>
          <div>
            <span className={s.eyebrow}>{t('CUSTOMER PROFILES', 'รูปแบบข้อมูลลูกค้า')}</span>
            <h2 id={titleId}>{t('Business types', 'ประเภทธุรกิจ')}</h2>
            <p id={descriptionId}>
              {t(
                'Choose which details customers need for each kind of business.',
                'กำหนดข้อมูลลูกค้าที่เหมาะกับธุรกิจแต่ละประเภท',
              )}
            </p>
          </div>
          <button
            type="button"
            className={s.iconButton}
            aria-label={t('Close business types', 'ปิดประเภทธุรกิจ')}
            disabled={busy || !!pendingDiscard}
            onClick={dismiss}
          >
            <X size={21} />
          </button>
        </header>
        <div className={s.layout}>
          <aside className={s.typeList} aria-label={t('Business types', 'ประเภทธุรกิจ')}>
            <button
              ref={addRef}
              type="button"
              className={s.addButton}
              disabled={busy || !!pendingDiscard}
              onClick={() => edit()}
            >
              <Plus size={18} />
              {t('Add business type', 'เพิ่มประเภทธุรกิจ')}
            </button>
            {sortCatalog(data.businessTypes).map((type) => (
              <button
                type="button"
                key={type.id}
                className={`${s.typeButton} ${draft?.id === type.id ? s.selected : ''}`}
                aria-pressed={draft?.id === type.id}
                disabled={busy || !!pendingDiscard}
                onClick={() => edit(type)}
              >
                <Settings2 size={18} />
                <span>
                  <strong>{t(type.name, type.nameTh || type.name)}</strong>
                  <small>
                    {t(
                      `${type.customerSections.length} sections · ${type.customerFields.filter((field) => !field.archived).length} extra fields`,
                      `${type.customerSections.length} หมวด · ${type.customerFields.filter((field) => !field.archived).length} ช่องเพิ่มเติม`,
                    )}
                  </small>
                </span>
              </button>
            ))}
          </aside>
          {draft ? (
            <form className={s.form} onSubmit={save} aria-busy={busy}>
              <div className={s.formBody}>
                <div className={s.formHeading}>
                  <h3>
                    {baseline
                      ? t('Edit business type', 'แก้ไขประเภทธุรกิจ')
                      : t('New business type', 'ประเภทธุรกิจใหม่')}
                  </h3>
                  <p>
                    {t(
                      'Changes apply to every company using this business type.',
                      'การแก้ไขจะใช้กับทุกบริษัทที่เลือกประเภทธุรกิจนี้',
                    )}
                  </p>
                </div>
                <fieldset disabled={busy || !!pendingDiscard} className={s.fields}>
                  <legend className={s.srOnly}>
                    {t('Business type details', 'ข้อมูลประเภทธุรกิจ')}
                  </legend>
                  <label>
                    {t('Business type name', 'ชื่อประเภทธุรกิจ')}
                    <input
                      ref={nameRef}
                      required
                      maxLength={100}
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </label>
                  <fieldset className={s.sectionChoices}>
                    <legend>{t('Customer sections', 'หมวดข้อมูลลูกค้า')}</legend>
                    {sections.map((section) => (
                      <label key={section.id} className={s.sectionChoice}>
                        <input
                          type="checkbox"
                          checked={draft.customerSections.includes(section.id)}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              customerSections: event.target.checked
                                ? [...draft.customerSections, section.id]
                                : draft.customerSections.filter((value) => value !== section.id),
                            })
                          }
                        />
                        <span>
                          <strong>{t(section.en, section.th)}</strong>
                          <small>{t(section.detailEn, section.detailTh)}</small>
                        </span>
                      </label>
                    ))}
                    <p>
                      {t(
                        'Hidden sections keep their saved customer data.',
                        'หมวดที่ซ่อนจะยังเก็บข้อมูลลูกค้าที่เคยบันทึกไว้',
                      )}
                    </p>
                  </fieldset>
                  <section className={s.customSection}>
                    <div className={s.sectionHeading}>
                      <div>
                        <h4>{t('Extra customer fields', 'ช่องข้อมูลลูกค้าเพิ่มเติม')}</h4>
                        <p>
                          {t(
                            'Add details that fit your business.',
                            'เพิ่มข้อมูลให้เหมาะกับธุรกิจของคุณ',
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={s.secondaryButton}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            customerFields: [
                              ...draft.customerFields,
                              { id: crypto.randomUUID(), label: '', type: 'text' },
                            ],
                          })
                        }
                      >
                        <Plus size={17} />
                        {t('Add field', 'เพิ่มช่องข้อมูล')}
                      </button>
                    </div>
                    {draft.customerFields
                      .filter((field) => !field.archived)
                      .map((field) => (
                        <div className={s.fieldRow} key={field.id}>
                          <label>
                            {t('Field label', 'ชื่อช่องข้อมูล')}
                            <input
                              required
                              maxLength={100}
                              value={field.label}
                              onChange={(event) =>
                                patchField(field.id, { label: event.target.value })
                              }
                            />
                          </label>
                          <SelectionField
                            label={t('Field type', 'ชนิดข้อมูล')}
                            value={field.type}
                            options={fieldTypes.map((type) => ({ ...type, value: type.id }))}
                            t={t}
                            disabled={
                              busy ||
                              !!baseline?.customerFields.some((item) => item.id === field.id)
                            }
                            onSelect={(value) =>
                              patchField(field.id, { type: value as Field['type'] })
                            }
                          />
                          <button
                            type="button"
                            className={s.iconButton}
                            aria-label={t(
                              `Remove ${field.label || 'field'}`,
                              `นำ ${field.label || 'ช่องข้อมูล'} ออก`,
                            )}
                            onClick={() => removeField(field)}
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      ))}
                    {draft.customerFields.some((field) => field.archived) && (
                      <details className={s.archived}>
                        <summary>{t('Archived fields', 'ช่องข้อมูลที่เก็บถาวร')}</summary>
                        <p>
                          {t(
                            'Saved values are retained. Restore a field to show it again.',
                            'ข้อมูลที่บันทึกไว้ยังคงอยู่ กู้คืนช่องข้อมูลเพื่อให้แสดงอีกครั้ง',
                          )}
                        </p>
                        {draft.customerFields
                          .filter((field) => field.archived)
                          .map((field) => (
                            <div className={s.archivedRow} key={field.id}>
                              <span>{field.label}</span>
                              <button
                                type="button"
                                className={s.secondaryButton}
                                onClick={() => patchField(field.id, { archived: false })}
                              >
                                <RotateCcw size={16} />
                                {t('Restore', 'กู้คืน')}
                              </button>
                            </div>
                          ))}
                      </details>
                    )}
                    {draft.customerFields.some((field) =>
                      baseline?.customerFields.some((item) => item.id === field.id),
                    ) && (
                      <small className={s.note}>
                        {t(
                          'Existing field types stay fixed so saved customer values remain valid.',
                          'ชนิดของช่องเดิมจะเปลี่ยนไม่ได้ เพื่อให้ข้อมูลลูกค้าที่บันทึกไว้ยังถูกต้อง',
                        )}
                      </small>
                    )}
                  </section>
                </fieldset>
                {error && (
                  <p className={s.error} role="alert">
                    {error}
                  </p>
                )}
              </div>
              <footer className={s.actions}>
                <button
                  type="button"
                  className={s.secondaryButton}
                  disabled={busy || !!pendingDiscard}
                  onClick={() =>
                    runOrConfirm(() => {
                      setDraft(null);
                      setBaseline(null);
                      setDraftSnapshot('');
                      setError('');
                      requestAnimationFrame(() => addRef.current?.focus({ preventScroll: true }));
                    })
                  }
                >
                  {t('Cancel', 'ยกเลิก')}
                </button>
                <button
                  type="submit"
                  className={s.primaryButton}
                  disabled={busy || !!pendingDiscard}
                >
                  <Check size={18} />
                  {busy
                    ? t('Saving…', 'กำลังบันทึก…')
                    : t('Save business type', 'บันทึกประเภทธุรกิจ')}
                </button>
              </footer>
            </form>
          ) : (
            <div className={s.empty}>
              <Settings2 size={32} />
              <h3>{t('A profile for every business', 'รูปแบบข้อมูลสำหรับทุกธุรกิจ')}</h3>
              <p>
                {t(
                  'Choose a business type to edit, or add one for your next business.',
                  'เลือกประเภทธุรกิจเพื่อแก้ไข หรือเพิ่มประเภทสำหรับธุรกิจใหม่',
                )}
              </p>
            </div>
          )}
        </div>
      </div>
      {pendingDiscard && (
        <section className={p.discardPanel}>
          <div className={p.discardIcon}>
            <AlertTriangle size={27} aria-hidden="true" />
          </div>
          <span className={p.eyebrow}>{t('UNSAVED CHANGES', 'การแก้ไขที่ยังไม่บันทึก')}</span>
          <h2 id={discardTitleId}>
            {t('Discard unsaved changes?', 'ทิ้งการแก้ไขที่ยังไม่บันทึก?')}
          </h2>
          <p id={discardDescriptionId}>
            {t(
              'Your draft will stay open until you choose.',
              'ระบบจะเก็บการแก้ไขไว้จนกว่าคุณจะเลือก',
            )}
          </p>
          <div className={p.discardActions}>
            <button
              ref={keepEditingRef}
              type="button"
              className={p.cancelButton}
              onClick={keepEditing}
            >
              {t('Keep editing', 'แก้ไขต่อ')}
            </button>
            <button
              ref={discardRef}
              type="button"
              className={p.discardButton}
              onClick={() => {
                const action = pendingDiscard;
                setPendingDiscard(null);
                action();
              }}
            >
              {t('Discard changes', 'ทิ้งการแก้ไข')}
            </button>
          </div>
        </section>
      )}
    </dialog>
  );
}
