import { twMerge } from "tailwind-merge";

type Column = {
  label: string;
  className?: string;
};

type Row = {
  label: string;
  values: string[];
};

type TableProps = {
  columns: Column[];
  rows: Row[];
};

export function Table({ columns, rows }: TableProps) {
  return (
    <table>
      <thead>
        <tr>
          <td className="pr-3" />
          {columns.map((col) => (
            <td
              key={col.label}
              className={twMerge("px-3 text-right", col.className)}
            >
              {col.label}
            </td>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td className="pr-3">{row.label}</td>
            {row.values.map((value, i) => (
              <td key={columns[i]?.label ?? i} className="px-3 text-right">
                {value}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
