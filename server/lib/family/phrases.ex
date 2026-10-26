defmodule Family.Phrases do
  @moduledoc """
  Learning a language for a holiday: which phrases, signs and characters each
  person knows, so a family can see how they're getting on together. The
  phrases themselves live in the web app, and a key names one, like
  "ja.thank_you", "fr.sign.exit" or "ja.hira.ka".
  """
  import Ecto.Query
  alias Family.{Chat, Repo, Settings}
  alias Family.Accounts.User

  @key ~r/^(ja|fr)\.[a-z0-9_.]{1,40}$/
  @langs ~w(ja fr)

  @doc "What everyone in someone's own family knows, as `%{user_id, key}` maps."
  def known_for(%User{} = user) do
    family = family_ids(user)
    Repo.all(from k in "phrases_known", where: k.user_id in ^family, order_by: [k.user_id, k.key], select: %{user_id: k.user_id, key: k.key})
  end

  @doc "Someone says they know a phrase now, or don't yet. Their family's screens catch up."
  def mark(%User{} = user, key, known) do
    if is_binary(key) and key =~ @key do
      if known == true do
        Repo.insert_all("phrases_known", [%{user_id: user.id, key: key, inserted_at: DateTime.utc_now(:second)}], on_conflict: :nothing)
      else
        Repo.delete_all(from k in "phrases_known", where: k.user_id == ^user.id and k.key == ^key)
      end

      for id <- family_ids(user), id != user.id, do: Chat.notify_user(id, "phrases_changed", %{})
      :ok
    else
      {:error, "That isn't one of the phrases."}
    end
  end

  @doc "When the household's holidays start, by language, like %{\"ja\" => \"2027-04-03\"}."
  def trips(%User{} = user) do
    for lang <- @langs, date = Settings.get(trip_key(user, lang)), date != nil, into: %{}, do: {lang, date}
  end

  @doc "A grown-up sets when the household goes, or clears it with nil."
  def set_trip(%User{role: "kid"}, _lang, _date), do: {:error, "Only a grown-up can set when you go."}

  def set_trip(%User{} = user, lang, date) when lang in @langs do
    with :ok <- save_trip(trip_key(user, lang), date) do
      for id <- family_ids(user), id != user.id, do: Chat.notify_user(id, "phrases_changed", %{})
      :ok
    end
  end

  def set_trip(_user, _lang, _date), do: {:error, "That isn't one of the languages."}

  defp save_trip(key, nil), do: Settings.delete(key)

  defp save_trip(key, date) when is_binary(date) do
    case Date.from_iso8601(date) do
      {:ok, day} -> Settings.put(key, Date.to_iso8601(day))
      _ -> {:error, "That isn't a date."}
    end
  end

  defp save_trip(_key, _date), do: {:error, "That isn't a date."}

  defp trip_key(%User{bubble_id: nil, id: id}, lang), do: "trip:user#{id}:#{lang}"
  defp trip_key(%User{bubble_id: bubble}, lang), do: "trip:#{bubble}:#{lang}"

  @doc "Every key someone knows, for their download."
  def keys(%User{id: id}), do: Repo.all(from k in "phrases_known", where: k.user_id == ^id, order_by: k.key, select: k.key)

  defp family_ids(%User{bubble_id: nil, id: id}), do: [id]
  defp family_ids(%User{bubble_id: bubble}), do: Repo.all(from u in User, where: u.bubble_id == ^bubble and u.active, select: u.id)
end
