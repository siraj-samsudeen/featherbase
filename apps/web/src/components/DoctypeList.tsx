import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";

export function DoctypeList() {
  const { data: doctypes, error } = useQuery(
    convexQuery(api.doctypes.list, {}),
  );

  if (error)
    return <p role="alert">Could not load DocTypes: {error.message}</p>;
  if (doctypes === undefined) return <p>Loading…</p>;

  return (
    <section>
      <h2>DocTypes</h2>
      {doctypes.length === 0 ? (
        <p>No DocTypes yet</p>
      ) : (
        <ul>
          {doctypes.map((doctype) => (
            <li key={doctype.name}>
              <Link to="/doctypes/$doctype" params={{ doctype: doctype.name }}>
                {doctype.label ?? doctype.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/doctypes/new">New DocType</Link>
    </section>
  );
}
