import { useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export function TaskList() {
  const { data: tasks, error } = useQuery(convexQuery(api.tasks.list, {}));
  const addTask = useMutation(api.tasks.add);
  const [text, setText] = useState("");

  if (error) {
    return <p role="alert">Could not load tasks: {error.message}</p>;
  }
  if (tasks === undefined) {
    return <p>Loading…</p>;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await addTask({ text });
    setText("");
  }

  return (
    <section>
      {tasks.length === 0 ? (
        <p>No tasks yet</p>
      ) : (
        <ul>
          {tasks.map((task) => (
            <li key={task._id}>{task.text}</li>
          ))}
        </ul>
      )}
      <form onSubmit={(event) => void handleSubmit(event)}>
        <label htmlFor="new-task">Task</label>
        <input
          id="new-task"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit">Add</button>
      </form>
    </section>
  );
}
