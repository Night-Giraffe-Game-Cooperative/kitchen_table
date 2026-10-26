defmodule Family.PhrasesTest do
  use FamilyWeb.ConnCase, async: false
  alias Family.Phrases

  test "each person marks the phrases they know, and their own family sees it" do
    admin = admin_fixture()
    kid = person_fixture(admin, "kid", "Robin")
    cousin = person_fixture(admin, "grownup", "Kim", %{"bubble_name" => "The cousins"})

    alex = sign_in(build_conn() |> put_req_header("x-family", "1"), "alex@example.com", "a good password")
    assert %{"ok" => true} = alex |> put("/api/phrases/known", %{"key" => "ja.thank_you", "known" => true}) |> json_response(200)
    # Saying so twice is fine.
    assert alex |> put("/api/phrases/known", %{"key" => "ja.thank_you", "known" => true}) |> json_response(200)
    :ok = Phrases.mark(kid, "fr.hello", true)
    :ok = Phrases.mark(kid, "ja.hira.ka", true)
    :ok = Phrases.mark(cousin, "fr.hello", true)

    assert %{"known" => known} = alex |> get("/api/phrases") |> json_response(200)
    assert Enum.sort(known) ==
             Enum.sort([
               %{"user_id" => admin.id, "key" => "ja.thank_you"},
               %{"user_id" => kid.id, "key" => "fr.hello"},
               %{"user_id" => kid.id, "key" => "ja.hira.ka"}
             ])

    # Another household only sees its own.
    assert Phrases.known_for(cousin) == [%{user_id: cousin.id, key: "fr.hello"}]

    # Not yet, after all.
    assert alex |> put("/api/phrases/known", %{"key" => "ja.thank_you", "known" => false}) |> json_response(200)
    refute Enum.any?(Phrases.known_for(admin), &(&1.user_id == admin.id))

    # Only keys that name a phrase.
    assert %{"error" => _} = alex |> put("/api/phrases/known", %{"key" => "<b>hi</b>", "known" => true}) |> json_response(422)
    assert {:error, _} = Phrases.mark(admin, "de.hallo", true)

    assert Phrases.keys(kid) == ["fr.hello", "ja.hira.ka"]
  end

  test "a grown-up sets when the family goes, and everyone at home counts down" do
    admin = admin_fixture()
    kid = person_fixture(admin, "kid", "Robin")
    cousin = person_fixture(admin, "grownup", "Kim", %{"bubble_name" => "The cousins"})

    alex = sign_in(build_conn() |> put_req_header("x-family", "1"), "alex@example.com", "a good password")
    assert %{"trips" => %{}} = alex |> get("/api/phrases") |> json_response(200)
    assert alex |> put("/api/phrases/trip", %{"lang" => "ja", "date" => "2027-04-03"}) |> json_response(200)
    assert %{"trips" => %{"ja" => "2027-04-03"}} = alex |> get("/api/phrases") |> json_response(200)
    assert Phrases.trips(kid) == %{"ja" => "2027-04-03"}
    # Another household has its own holidays.
    assert Phrases.trips(cousin) == %{}

    assert {:error, _} = Phrases.set_trip(kid, "ja", "2027-05-01")
    assert {:error, _} = Phrases.set_trip(admin, "ja", "next week")
    assert {:error, _} = Phrases.set_trip(admin, "de", "2027-05-01")
    assert Phrases.trips(kid) == %{"ja" => "2027-04-03"}

    # No date yet, after all.
    assert alex |> put("/api/phrases/trip", %{"lang" => "ja", "date" => nil}) |> json_response(200)
    assert Phrases.trips(kid) == %{}
  end
end
