package com.nightgiraffe.kitchentable;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.http.SslCertificate;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.text.InputType;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Kitchen Table, full screen, for tablets whose home screen won't take a browser
 * shortcut. It opens the family's own computer and does what the browser would:
 * camera and microphone for video calls, photos to send, and the home-made
 * certificate (trusted the first time, then held to it).
 */
public class MainActivity extends Activity {
    private static final int ASK_CALL = 1;
    private static final int ASK_PHOTO = 2;
    private static final int PICK_PHOTO = 3;

    private static final int PAPER = Color.rgb(245, 243, 238);
    private static final int INK = Color.rgb(29, 29, 31);
    private static final int SOFT_INK = Color.rgb(92, 90, 86);
    private static final int HEART = Color.rgb(214, 92, 84);

    private SharedPreferences prefs;
    private WebView web;
    private ScrollView problem;
    private TextView problemText;
    private EditText addressBox;
    private Button trustButton;
    private boolean failed;

    private PermissionRequest waitingCall;
    private ValueCallback<Uri[]> waitingPhoto;
    private WebChromeClient.FileChooserParams photoParams;
    private Uri snapshot;
    private String newCertificate;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences("kitchen-table", MODE_PRIVATE);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(PAPER);
        web = new WebView(this);
        web.setBackgroundColor(PAPER);
        setUpWeb();
        root.addView(web, fill());
        problem = buildProblem();
        problem.setVisibility(View.GONE);
        root.addView(problem, fill());
        setContentView(root);

        if (saved == null || web.restoreState(saved) == null) web.loadUrl(home() + "/");
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            problem.setVisibility(View.GONE);
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (waitingCall != null) waitingCall.deny();
        if (waitingPhoto != null) waitingPhoto.onReceiveValue(null);
        web.destroy();
        super.onDestroy();
    }

    // The page

    private void setUpWeb() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " KitchenTableApp/" + version());
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (isHome(url)) return false;
                // Kitchen Table has moved (the PC sends everyone to the VPS, say): follow it and remember.
                if (request.isForMainFrame() && request.isRedirect()
                        && "https".equalsIgnoreCase(url.getScheme()) && url.getHost() != null) {
                    prefs.edit().putString("home", tidy(url.getScheme() + "://" + url.getEncodedAuthority())).remove("certificate").apply();
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (Exception ignored) {
                    // No browser allowed on this tablet: stay put.
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                failed = false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!failed) problem.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                failed = true;
                showProblem("Can't reach the kitchen table at " + shortHome() + ".\n\n"
                        + "Check that the computer is on and Kitchen Table is running on it, "
                        + "and that this tablet is on the home Wi-Fi.", false);
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                Uri url = Uri.parse(error.getUrl());
                String print = fingerprint(error.getCertificate());
                String trusted = prefs.getString("certificate", null);
                if (!isHome(url) || !isAtHome(url.getHost()) || print == null) {
                    handler.cancel();
                    return;
                }
                if (trusted == null || trusted.equals(print)) {
                    if (trusted == null) prefs.edit().putString("certificate", print).apply();
                    handler.proceed();
                    return;
                }
                handler.cancel();
                failed = true;
                newCertificate = print;
                showProblem("The computer at " + shortHome() + " has a different certificate from last time.\n\n"
                        + "That's expected if Kitchen Table was set up again on that computer. "
                        + "If it wasn't, ask a grown-up before carrying on.", true);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> askForCall(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (waitingCall == request) waitingCall = null;
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (waitingPhoto != null) waitingPhoto.onReceiveValue(null);
                waitingPhoto = callback;
                photoParams = params;
                if (Build.VERSION.SDK_INT >= 29 && !has(Manifest.permission.CAMERA)) {
                    requestPermissions(new String[] {Manifest.permission.CAMERA}, ASK_PHOTO);
                } else {
                    choosePhoto();
                }
                return true;
            }
        });
    }

    // Camera and microphone for video calls

    private void askForCall(PermissionRequest request) {
        if (!isHome(request.getOrigin())) {
            request.deny();
            return;
        }
        List<String> needed = new ArrayList<>();
        for (String r : request.getResources()) {
            if (r.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE) && !has(Manifest.permission.CAMERA)) {
                needed.add(Manifest.permission.CAMERA);
            } else if (r.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE) && !has(Manifest.permission.RECORD_AUDIO)) {
                needed.add(Manifest.permission.RECORD_AUDIO);
            }
        }
        if (needed.isEmpty()) {
            grant(request);
            return;
        }
        if (waitingCall != null) waitingCall.deny();
        waitingCall = request;
        requestPermissions(needed.toArray(new String[0]), ASK_CALL);
    }

    private void grant(PermissionRequest request) {
        List<String> allowed = new ArrayList<>();
        for (String r : request.getResources()) {
            if ((r.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE) && has(Manifest.permission.CAMERA))
                    || (r.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE) && has(Manifest.permission.RECORD_AUDIO))) {
                allowed.add(r);
            }
        }
        if (allowed.isEmpty()) request.deny();
        else request.grant(allowed.toArray(new String[0]));
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (code == ASK_CALL && waitingCall != null) {
            grant(waitingCall);
            waitingCall = null;
        } else if (code == ASK_PHOTO) {
            choosePhoto();
        }
    }

    // Photos to send: the gallery, or the camera when it's allowed

    private void choosePhoto() {
        if (waitingPhoto == null) return;
        Intent pick = photoParams != null ? photoParams.createIntent() : new Intent(Intent.ACTION_GET_CONTENT);
        if (pick.getType() == null) pick.setType("image/*");
        Intent chooser = Intent.createChooser(pick, "Send a photo");
        snapshot = null;
        if (Build.VERSION.SDK_INT >= 29 && has(Manifest.permission.CAMERA)) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, "kitchen-table-" + System.currentTimeMillis() + ".jpg");
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Kitchen Table");
            try {
                snapshot = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            } catch (Exception e) {
                snapshot = null;
            }
            if (snapshot != null) {
                Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                        .putExtra(MediaStore.EXTRA_OUTPUT, snapshot)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] {camera});
            }
        }
        try {
            startActivityForResult(chooser, PICK_PHOTO);
        } catch (Exception e) {
            finishPhoto(null);
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code != PICK_PHOTO) {
            super.onActivityResult(code, result, data);
            return;
        }
        Uri[] picked = null;
        if (result == RESULT_OK) {
            if (data != null && (data.getData() != null || data.getClipData() != null)) {
                picked = WebChromeClient.FileChooserParams.parseResult(result, data);
            } else if (snapshot != null) {
                picked = new Uri[] {snapshot};
            }
        }
        finishPhoto(picked);
    }

    private void finishPhoto(Uri[] picked) {
        if (snapshot != null && (picked == null || picked.length == 0 || !snapshot.equals(picked[0]))) {
            try {
                getContentResolver().delete(snapshot, null, null);
            } catch (Exception ignored) {
                // Nothing was saved there.
            }
        }
        snapshot = null;
        if (waitingPhoto != null) waitingPhoto.onReceiveValue(picked);
        waitingPhoto = null;
        photoParams = null;
    }

    // When the computer can't be reached

    private ScrollView buildProblem() {
        int pad = dp(28);
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER_HORIZONTAL);
        column.setPadding(pad, dp(56), pad, pad);

        TextView heart = text("♥", 44, HEART);
        column.addView(heart, wrap());

        TextView title = text("Kitchen Table", 28, INK);
        title.setTypeface(Typeface.create(Typeface.SERIF, Typeface.BOLD));
        title.setPadding(0, dp(4), 0, dp(16));
        column.addView(title, wrap());

        problemText = text("", 18, SOFT_INK);
        problemText.setGravity(Gravity.CENTER);
        problemText.setLineSpacing(0, 1.2f);
        column.addView(problemText, limited());

        Button again = button("Try again", true);
        again.setOnClickListener(v -> reload());
        column.addView(again, spaced(dp(28)));

        trustButton = button("Carry on with the new certificate", false);
        trustButton.setOnClickListener(v -> {
            if (newCertificate != null) prefs.edit().putString("certificate", newCertificate).apply();
            web.clearSslPreferences();
            reload();
        });
        column.addView(trustButton, spaced(dp(12)));

        TextView label = text("The computer's address", 15, SOFT_INK);
        label.setPadding(0, dp(40), 0, dp(6));
        column.addView(label, wrap());

        addressBox = new EditText(this);
        addressBox.setSingleLine(true);
        addressBox.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        addressBox.setImeOptions(EditorInfo.IME_ACTION_GO);
        addressBox.setTextColor(INK);
        addressBox.setGravity(Gravity.CENTER);
        addressBox.setOnEditorActionListener((v, action, event) -> {
            saveAddress();
            return true;
        });
        column.addView(addressBox, limited());

        Button save = button("Use this address", false);
        save.setOnClickListener(v -> saveAddress());
        column.addView(save, spaced(dp(12)));

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(PAPER);
        scroll.setFillViewport(true);
        scroll.addView(column, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return scroll;
    }

    private void showProblem(String message, boolean certificate) {
        problemText.setText(message);
        trustButton.setVisibility(certificate ? View.VISIBLE : View.GONE);
        addressBox.setText(shortHome());
        problem.setVisibility(View.VISIBLE);
    }

    private void reload() {
        problem.setVisibility(View.GONE);
        web.loadUrl(home() + "/");
    }

    private void saveAddress() {
        String typed = tidy(addressBox.getText().toString());
        if (typed.isEmpty()) return;
        if (!typed.equals(home())) {
            prefs.edit().putString("home", typed).remove("certificate").apply();
            web.clearSslPreferences();
        }
        InputMethodManager keyboard = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (keyboard != null) keyboard.hideSoftInputFromWindow(addressBox.getWindowToken(), 0);
        reload();
    }

    // Where home is

    private String home() {
        String saved = prefs.getString("home", null);
        return saved != null ? saved : tidy(builtInHome());
    }

    private String shortHome() {
        Uri u = Uri.parse(home());
        return u.getEncodedAuthority() != null ? u.getEncodedAuthority() : home();
    }

    private String builtInHome() {
        try {
            Bundle meta = getPackageManager()
                    .getApplicationInfo(getPackageName(), PackageManager.GET_META_DATA).metaData;
            String value = meta != null ? meta.getString("home") : null;
            return value != null ? value : "";
        } catch (PackageManager.NameNotFoundException e) {
            return "";
        }
    }

    private String version() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "1";
        }
    }

    /** "192.168.1.20:4443" or "https://192.168.1.20:4443/" becomes "https://192.168.1.20:4443". */
    private static String tidy(String address) {
        String a = address.trim();
        if (a.isEmpty()) return a;
        if (!a.contains("://")) a = "https://" + a;
        while (a.endsWith("/")) a = a.substring(0, a.length() - 1);
        return a;
    }

    private boolean isHome(Uri url) {
        if (url == null || url.getHost() == null) return false;
        Uri h = Uri.parse(home());
        return url.getHost().equalsIgnoreCase(h.getHost())
                && String.valueOf(url.getScheme()).equalsIgnoreCase(String.valueOf(h.getScheme()))
                && port(url) == port(h);
    }

    private static int port(Uri u) {
        if (u.getPort() != -1) return u.getPort();
        return "http".equalsIgnoreCase(u.getScheme()) ? 80 : 443;
    }

    /** The home-made certificate is only ever accepted for a computer on the home network. */
    private static boolean isAtHome(String host) {
        if (host == null) return false;
        String h = host.toLowerCase(Locale.ROOT);
        if (h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".home") || h.equals("localhost")) return true;
        String[] parts = h.split("\\.");
        if (parts.length != 4) return false;
        try {
            int a = Integer.parseInt(parts[0]);
            int b = Integer.parseInt(parts[1]);
            return a == 10 || (a == 192 && b == 168) || (a == 172 && b >= 16 && b <= 31);
        } catch (NumberFormatException e) {
            return false;
        }
    }

    private static String fingerprint(SslCertificate certificate) {
        if (certificate == null) return null;
        try {
            byte[] der = null;
            if (Build.VERSION.SDK_INT >= 29 && certificate.getX509Certificate() != null) {
                der = certificate.getX509Certificate().getEncoded();
            }
            if (der == null) der = SslCertificate.saveState(certificate).getByteArray("x509-certificate");
            if (der == null) return null;
            return Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(der), Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    // Little view helpers

    private boolean has(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    private TextView text(String value, int sp, int colour) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(colour);
        return t;
    }

    private Button button(String label, boolean main) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        b.setTextColor(main ? Color.WHITE : INK);
        b.setPadding(dp(24), dp(12), dp(24), dp(12));
        GradientDrawable shape = new GradientDrawable();
        shape.setCornerRadius(dp(14));
        shape.setColor(main ? HEART : Color.WHITE);
        if (!main) shape.setStroke(dp(2), INK);
        b.setBackground(shape);
        b.setStateListAnimator(null);
        return b;
    }

    private static FrameLayout.LayoutParams fill() {
        return new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    private static LinearLayout.LayoutParams wrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams limited() {
        int width = Math.min(dp(460), getResources().getDisplayMetrics().widthPixels - dp(56));
        return new LinearLayout.LayoutParams(width, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams spaced(int top) {
        LinearLayout.LayoutParams p = limited();
        p.topMargin = top;
        return p;
    }
}
