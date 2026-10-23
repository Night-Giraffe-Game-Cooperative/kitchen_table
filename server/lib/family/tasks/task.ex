defmodule Family.Tasks.Task do
  use Ecto.Schema
  import Ecto.Changeset

  @parts ~w(morning afternoon evening any)
  # A job someone ticks off; a reminder for grown-ups of what a child needs
  # that day; or homework, set on one day and due on another.
  @kinds ~w(job reminder homework)
  @statuses ~w(todo started done handed_in)

  schema "tasks" do
    field :kind, :string, default: "job"
    field :title, :string
    field :emoji, :string, default: "✅"
    field :notes, :string
    # Everyone it's for ticks it off separately. A reminder is about these
    # children; homework is for one child.
    field :user_ids, {:array, :integer}, default: []
    # Days of the week it comes round, 1 = Monday to 7 = Sunday; or a single
    # day in on_date for a one-off. Homework is set on on_date, due on due_on.
    field :days, {:array, :integer}, default: []
    field :on_date, :date
    field :part, :string, default: "any"
    field :subject, :string
    field :due_on, :date
    field :status, :string
    # What each tick earns. Reminders earn nothing.
    field :stars, :integer, default: 1
    field :pence, :integer, default: 0
    field :sticker, :boolean, default: false
    belongs_to :created_by, Family.Accounts.User
    timestamps(type: :utc_datetime)
  end

  def parts, do: @parts
  def statuses, do: @statuses

  def changeset(task, attrs) do
    # What kind of task it is is settled when it's made.
    fields = [:title, :emoji, :notes, :user_ids, :days, :on_date, :part, :subject, :due_on, :stars, :pence, :sticker]

    task
    |> cast(attrs, if(task.id, do: fields, else: [:kind | fields]))
    |> update_change(:title, &(&1 && String.trim(&1)))
    |> update_change(:notes, &blank_to_nil/1)
    |> update_change(:subject, &blank_to_nil/1)
    |> validate_required([:title], message: "needs a name")
    |> validate_length(:title, max: 80)
    |> validate_length(:emoji, min: 1, max: 16)
    |> validate_length(:notes, max: 500)
    |> validate_length(:subject, max: 40)
    |> validate_inclusion(:kind, @kinds)
    |> validate_inclusion(:part, @parts)
    |> validate_number(:stars, greater_than_or_equal_to: 0, less_than_or_equal_to: 5)
    |> validate_number(:pence, greater_than_or_equal_to: 0, less_than_or_equal_to: 10_000)
    |> update_change(:days, &(&1 |> Enum.uniq() |> Enum.sort()))
    |> validate_change(:days, fn :days, days ->
      if Enum.all?(days, &(&1 in 1..7)), do: [], else: [days: "must be days of the week"]
    end)
    |> then(fn c ->
      if get_field(c, :user_ids) == [], do: add_error(c, :user_ids, "need someone to do it"), else: c
    end)
    |> by_kind()
  end

  defp by_kind(changeset) do
    case get_field(changeset, :kind) do
      "homework" ->
        changeset
        |> put_change(:days, [])
        |> put_change(:status, get_field(changeset, :status) || "todo")
        |> validate_required([:on_date, :due_on], message: "needs a day")
        |> validate_length(:user_ids, is: 1, message: "is for one child at a time")
        |> then(fn c ->
          set = get_field(c, :on_date)
          due = get_field(c, :due_on)
          if set && due && Date.compare(due, set) == :lt, do: add_error(c, :due_on, "can't be before it's set"), else: c
        end)

      kind ->
        changeset
        |> then(fn c ->
          if get_field(c, :days) == [] and is_nil(get_field(c, :on_date)),
            do: add_error(c, :days, "need choosing, or a day for a one-off"),
            else: c
        end)
        |> then(fn c ->
          if kind == "reminder", do: change(c, stars: 0, pence: 0, sticker: false), else: c
        end)
    end
  end

  defp blank_to_nil(nil), do: nil

  defp blank_to_nil(text) do
    case String.trim(text) do
      "" -> nil
      text -> text
    end
  end
end

defmodule Family.Tasks.Completion do
  use Ecto.Schema

  # A task ticked off (or homework handed in), and what it earned. A kid's
  # tick on a task a grown-up set is waiting until a grown-up checks it, and
  # earns nothing till then.
  schema "task_completions" do
    belongs_to :task, Family.Tasks.Task
    belongs_to :user, Family.Accounts.User
    field :on, :date
    belongs_to :done_by, Family.Accounts.User
    field :waiting, :boolean, default: false
    field :stars, :integer, default: 1
    field :pence, :integer, default: 0
    field :sticker, :string
    timestamps(type: :utc_datetime, updated_at: false)
  end
end

defmodule Family.Tasks.Payout do
  use Ecto.Schema

  # Pocket money a grown-up has paid out.
  schema "payouts" do
    belongs_to :user, Family.Accounts.User
    field :pence, :integer
    belongs_to :paid_by, Family.Accounts.User
    timestamps(type: :utc_datetime, updated_at: false)
  end
end

defmodule Family.Tasks.Goal do
  use Ecto.Schema
  import Ecto.Changeset

  # A treat a child is saving stars up for. Stars count from when it's set.
  schema "goals" do
    belongs_to :user, Family.Accounts.User
    field :title, :string
    field :emoji, :string, default: "🎁"
    field :stars, :integer
    belongs_to :created_by, Family.Accounts.User
    field :given_at, :utc_datetime
    timestamps(type: :utc_datetime)
  end

  def changeset(goal, attrs) do
    goal
    |> cast(attrs, [:title, :emoji, :stars])
    |> update_change(:title, &(&1 && String.trim(&1)))
    |> validate_required([:title], message: "needs a name")
    |> validate_required([:stars], message: "need a number")
    |> validate_length(:title, max: 80)
    |> validate_length(:emoji, min: 1, max: 16)
    |> validate_number(:stars, greater_than: 0, less_than_or_equal_to: 1000)
  end
end
