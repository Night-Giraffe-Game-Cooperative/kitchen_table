defmodule Family.Calendar.Event do
  use Ecto.Schema
  import Ecto.Changeset

  @repeats ~w(none daily weekly monthly yearly)

  schema "calendar_events" do
    field :title, :string
    field :emoji, :string, default: "📅"
    field :notes, :string
    field :location, :string
    field :all_day, :boolean, default: false
    # A timed event has starts_at and ends_at; an all-day one has start_date
    # and end_date, both days included.
    field :starts_at, :utc_datetime
    field :ends_at, :utc_datetime
    field :start_date, :date
    field :end_date, :date
    field :time_zone, :string, default: "Europe/London"
    # Repeats of events kept here are worked out by the web app in the
    # viewer's own time, so a 9 o'clock swim stays at 9 when the clocks change.
    # Events from a linked calendar arrive one row per occurrence, so they
    # never repeat here; `recurring` says the calendar they're from repeats them.
    field :repeat, :string, default: "none"
    field :repeat_until, :date
    field :who, {:array, :integer}, default: []
    # "app" for events kept here; "caldav" or "ics" for a linked calendar's.
    field :source, :string, default: "app"
    belongs_to :link, Family.Calendar.Link
    field :remote_uid, :string
    # Which occurrence of a repeating event; "" for one that doesn't repeat.
    field :remote_key, :string
    field :remote_href, :string
    field :remote_etag, :string
    field :recurring, :boolean, default: false
    belongs_to :created_by, Family.Accounts.User
    timestamps(type: :utc_datetime)
  end

  def repeats, do: @repeats

  @fields [:title, :emoji, :notes, :location, :all_day, :starts_at, :ends_at, :start_date, :end_date, :time_zone, :repeat, :repeat_until, :who]

  def changeset(event, attrs) do
    event
    |> cast(attrs, @fields)
    |> update_change(:title, &trim/1)
    |> update_change(:notes, &trim/1)
    |> update_change(:location, &trim/1)
    |> validate_required([:title], message: "needs a name")
    |> validate_length(:title, max: 120)
    |> validate_length(:notes, max: 4000)
    |> validate_length(:location, max: 200)
    |> validate_length(:emoji, min: 1, max: 16)
    |> update_change(:time_zone, &known_zone/1)
    |> validate_inclusion(:repeat, @repeats)
    |> validate_when()
  end

  defp validate_when(changeset) do
    if get_field(changeset, :all_day) do
      changeset
      |> validate_required([:start_date], message: "needs a day")
      |> default(:end_date, get_field(changeset, :start_date))
      |> put_change(:starts_at, nil)
      |> put_change(:ends_at, nil)
      |> check(fn c ->
        d1 = get_field(c, :start_date)
        d2 = get_field(c, :end_date)
        if d1 && d2 && Date.compare(d2, d1) == :lt, do: {:end_date, "is before it starts"}
      end)
      |> check_until(get_field(changeset, :start_date))
    else
      starts = get_field(changeset, :starts_at)

      changeset
      |> validate_required([:starts_at], message: "needs a time")
      |> default(:ends_at, starts && DateTime.add(starts, 3600))
      |> put_change(:start_date, nil)
      |> put_change(:end_date, nil)
      |> check(fn c ->
        t1 = get_field(c, :starts_at)
        t2 = get_field(c, :ends_at)

        cond do
          is_nil(t1) or is_nil(t2) -> nil
          DateTime.compare(t2, t1) == :lt -> {:ends_at, "is before it starts"}
          DateTime.diff(t2, t1) > 31 * 86_400 -> {:ends_at, "is more than a month after it starts"}
          true -> nil
        end
      end)
      |> check_until(starts && DateTime.to_date(starts))
    end
  end

  defp check_until(changeset, first) do
    check(changeset, fn c ->
      until = get_field(c, :repeat_until)
      if until && first && get_field(c, :repeat) != "none" && Date.compare(until, first) == :lt, do: {:repeat_until, "is before it starts"}
    end)
  end

  # A phone can name a zone the server doesn't know yet (a new one, or a
  # typo); the family's own zone is the best guess then.
  defp known_zone(zone) do
    if is_binary(zone) and byte_size(zone) <= 64 and match?({:ok, _}, DateTime.now(zone)),
      do: zone,
      else: Application.get_env(:family, :time_zone, "Europe/London")
  end

  defp default(changeset, field, value) do
    if is_nil(get_field(changeset, field)), do: put_change(changeset, field, value), else: changeset
  end

  defp check(changeset, fun) do
    case fun.(changeset) do
      {field, message} -> add_error(changeset, field, message)
      nil -> changeset
    end
  end

  defp trim(nil), do: nil
  defp trim(s), do: String.trim(s)
end
