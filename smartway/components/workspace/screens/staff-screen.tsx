import { heading } from "../ui";
import { useDemoStore } from "../demo-store";
export function StaffScreen({
  setMessage,
}: {
  setMessage: React.Dispatch<React.SetStateAction<string>>;
}) {
  const { staff, setStaff } = useDemoStore();
  return (
    <>
      {heading(
        "ADMINISTRAÇÃO",
        "Funcionários",
        "Gerencie colaboradores nesta demonstração.",
      )}
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Equipe cadastrada</h2>
            <p>{staff.length} colaboradores na lista.</p>
          </div>
        </div>
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem(
              "name",
            ) as HTMLInputElement;
            const name = input.value.trim();
            if (name) {
              setStaff((items) => [...items, name]);
              input.value = "";
              setMessage("Funcionário adicionado nesta demonstração.");
            }
          }}
        >
          <label className="sr-only" htmlFor="staff-name">
            Nome do funcionário
          </label>
          <input
            id="staff-name"
            name="name"
            required
            maxLength={80}
            placeholder="Nome do funcionário"
          />
          <button className="button primary">Adicionar</button>
        </form>
        {staff.map((name, index) => (
          <div className="staff-row" key={name + index}>
            <span className="avatar">{name[0]}</span>
            <strong>{name}</strong>
            <button
              className="link-button danger"
              onClick={() => {
                setStaff((items) => items.filter((_, i) => i !== index));
                setMessage("Funcionário removido desta demonstração.");
              }}
              aria-label={"Remover " + name}
            >
              Remover
            </button>
          </div>
        ))}
      </section>
    </>
  );
}
