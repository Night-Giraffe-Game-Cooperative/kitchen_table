package com.nightgiraffe.kitchentable;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Context;

/**
 * Android starts this now and then to check Kitchen Table for notifications
 * (Inbox): every 15 minutes or so, and about every minute while the app is
 * open, in front or behind.
 */
public final class InboxJob extends JobService {
    @Override
    public boolean onStartJob(final JobParameters params) {
        final Context app = getApplicationContext();
        final int id = params.getJobId();
        final boolean soon = id != Inbox.EVERY_15_MINUTES;
        if (soon) Inbox.startedSoon();
        // Off the main thread, since it uses the network.
        new Thread(() -> {
            try {
                Inbox.check(app, true);
            } finally {
                jobFinished(params, false);
                if (soon) Inbox.finishedSoon(app, id);
            }
        }, "kitchen-table-inbox").start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        // Out of time, or off the network: the next check will do.
        return false;
    }
}
