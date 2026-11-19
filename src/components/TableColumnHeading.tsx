import type { LucideIcon } from 'lucide-react';
import s from './TableColumnHeading.module.css';

type SortAction = {
  direction: 'ascending' | 'descending' | undefined;
  nextLabel: string;
  onClick: () => void;
};

interface Props {
  label: string;
  description?: string;
  icon: LucideIcon;
  secondaryIcon?: LucideIcon;
  className?: string;
  sort?: SortAction;
  secondarySort?: SortAction;
}

export default function TableColumnHeading({
  label,
  description,
  icon: Icon,
  secondaryIcon: SecondaryIcon,
  className,
  sort,
  secondarySort,
}: Props) {
  const title = description ? `${label} — ${description}` : label;
  return (
    <th
      scope="col"
      aria-label={label}
      aria-sort={sort?.direction ?? secondarySort?.direction}
      className={className}
      title={title}
    >
      {sort ? (
        <span className={s.actions}>
          <SortButton
            icon={Icon}
            secondaryIcon={secondarySort ? undefined : SecondaryIcon}
            sort={sort}
            description={description}
          />
          {secondarySort && SecondaryIcon && (
            <SortButton icon={SecondaryIcon} sort={secondarySort} />
          )}
        </span>
      ) : (
        <span className={s.icons} aria-hidden="true">
          <Icon className={s.icon} />
          {SecondaryIcon && <SecondaryIcon className={s.icon} />}
        </span>
      )}
      <span className={s.srOnly}>{label}</span>
    </th>
  );
}

function SortButton({
  icon: Icon,
  secondaryIcon: SecondaryIcon,
  sort,
  description,
}: {
  icon: LucideIcon;
  secondaryIcon?: LucideIcon;
  sort: SortAction;
  description?: string;
}) {
  return (
    <button
      className={s.sortButton}
      type="button"
      aria-label={sort.nextLabel}
      aria-description={description}
      title={description ? `${sort.nextLabel} — ${description}` : sort.nextLabel}
      data-active={sort.direction ? true : undefined}
      onClick={sort.onClick}
    >
      <Icon className={s.icon} aria-hidden="true" />
      {SecondaryIcon && <SecondaryIcon className={s.icon} aria-hidden="true" />}
    </button>
  );
}
