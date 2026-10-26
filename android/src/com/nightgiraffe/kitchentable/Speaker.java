package com.nightgiraffe.kitchentable;

import android.app.Activity;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import java.util.Locale;

/**
 * The tablet's voice, lent to the page: a web view can't speak on its own, and
 * Kitchen Table reads stories aloud and says holiday phrases in Japanese and
 * French. The page calls it as KitchenTableVoice.
 */
public final class Speaker {
    private final Activity activity;
    private TextToSpeech tts;
    private boolean ready;
    private boolean broken;
    private Runnable waiting;

    Speaker(Activity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public void speak(final String text, final String lang, final float rate) {
        activity.runOnUiThread(() -> say(text, lang, rate));
    }

    @JavascriptInterface
    public void stop() {
        activity.runOnUiThread(() -> {
            waiting = null;
            if (tts != null) tts.stop();
        });
    }

    void shutdown() {
        if (tts != null) tts.shutdown();
        tts = null;
        ready = false;
        waiting = null;
    }

    private void say(final String text, final String lang, final float rate) {
        if (text == null || text.trim().isEmpty()) return;
        if (broken) {
            Toast.makeText(activity, "This tablet can't read aloud. Check Settings, then Text-to-speech.", Toast.LENGTH_LONG).show();
            return;
        }
        if (!ready) {
            // The voice takes a moment to wake the first time: say it once it's up.
            waiting = () -> say(text, lang, rate);
            if (tts == null) {
                tts = new TextToSpeech(activity, status -> {
                    ready = status == TextToSpeech.SUCCESS;
                    broken = !ready;
                    Runnable next = waiting;
                    waiting = null;
                    if (next != null) next.run();
                });
            }
            return;
        }
        Locale locale = Locale.forLanguageTag(lang == null || lang.isEmpty() ? "en-GB" : lang);
        int has = tts.setLanguage(locale);
        if (has == TextToSpeech.LANG_MISSING_DATA || has == TextToSpeech.LANG_NOT_SUPPORTED) {
            Toast.makeText(activity, "This tablet has no " + locale.getDisplayLanguage(Locale.UK)
                    + " voice yet. Add one in Settings, under Text-to-speech.", Toast.LENGTH_LONG).show();
            return;
        }
        tts.setSpeechRate(rate > 0 ? rate : 1f);
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "kitchen-table");
    }
}
