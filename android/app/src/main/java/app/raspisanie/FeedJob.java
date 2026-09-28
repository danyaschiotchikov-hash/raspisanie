package app.raspisanie;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

/**
 * Проверка изменений в расписании в фоне: раз в 15 минут, когда есть интернет.
 * В режиме экономии заряда Android может откладывать запуск — тогда уведомление придёт позже.
 */
public class FeedJob extends JobService {
    private static final int ID = 1;
    private static final long PERIOD_MS = 15L * 60 * 1000;

    /** Ставит периодическую проверку, если её ещё нет (переживает перезагрузку телефона). */
    static void schedule(Context c) {
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null || js.getPendingJob(ID) != null) return;
        js.schedule(new JobInfo.Builder(ID, new ComponentName(c, FeedJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(PERIOD_MS)
                .setPersisted(true)
                .build());
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            FeedCheck.run(getApplicationContext());
            jobFinished(params, false);
        }, "feed-check").start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
