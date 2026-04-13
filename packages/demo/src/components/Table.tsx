type TableProps = {
  columns: { label: string }[];
  rows: { label: string; values: string[] }[];
};

export function Table({ columns, rows }: TableProps) {
  return (
    <table>
      <thead>
        <tr>
          <td className="pr-3" />
          {columns.map((col) => (
            <td key={col.label} className="px-3 text-right">
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
