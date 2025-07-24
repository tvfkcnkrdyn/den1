const express = require('express');
const fs = require('fs');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const PATIENTS_PATH = path.join(__dirname, 'patients.json');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
const nodemailer = require('nodemailer');
const GOOGLE_PLACE_ID = process.env.GOOGLE_PLACE_ID || 'YOUR_PLACE_ID';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'YOUR_API_KEY';
const fetch = require('node-fetch');

const app = express();
const PORT = 3001;
const DB_PATH = './db.json';
const APPOINTMENTS_DB_PATH = './appointments.json';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

const readDb = () => {
    try {
        const data = fs.readFileSync(DB_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading db.json:', err);
        return {};
    }
};

const readAppointmentsDb = () => {
    try {
        const data = fs.readFileSync(APPOINTMENTS_DB_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading appointments.json:', err);
        return [];
    }
};

const writeDb = (data) => {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error writing db.json:', err);
    }
};

const writeAppointmentsDb = (data) => {
    try {
        fs.writeFileSync(APPOINTMENTS_DB_PATH, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error writing appointments.json:', err);
    }
};

function readPatients() {
  try {
    return JSON.parse(fs.readFileSync(PATIENTS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}
function writePatients(patients) {
  fs.writeFileSync(PATIENTS_PATH, JSON.stringify(patients, null, 2), 'utf-8');
}
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
    req.patient = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// Opsiyonel auth middleware (token varsa req.patient ekler, yoksa devam eder)
function authMiddlewareOptional(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return next();
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
    req.patient = payload;
  } catch {}
  next();
}

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// Uploads klasörü ve multer ayarları
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});
const upload = multer({ storage: storage });

app.use('/uploads', express.static(UPLOADS_DIR));

// dist klasörünü statik olarak sun
app.use(express.static(path.join(__dirname, 'dist')));

// Kök (/) isteğinde dist/index.html döndür
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// --- GET (Read) Endpoints ---
app.get('/api/doctors', (req, res) => {
    const db = readDb();
    res.json(db.doctors);
});
app.get('/api/services', (req, res) => {
    const db = readDb();
    res.json(db.services);
});
app.get('/api/testimonials', (req, res) => {
    const db = readDb();
    res.json(db.testimonials);
});
app.get('/api/site-config', (req, res) => {
    const db = readDb();
    res.json({ ...db.siteConfig, seo: db.seo });
});
app.get('/api/page-content', (req, res) => {
    const db = readDb();
    res.json(db.pageContent);
});
app.get('/api/appointments', (req, res) => {
    const appointments = readAppointmentsDb();
    res.json(appointments);
});
app.get('/api/appointment-stats', (req, res) => {
  try {
    const appointments = JSON.parse(fs.readFileSync(path.join(__dirname, 'appointments.json'), 'utf-8'));
    const db = JSON.parse(fs.readFileSync(path.join(__dirname, 'db.json'), 'utf-8'));
    const doctors = db.doctors || [];
    const patients = readPatients();
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const total = appointments.length;
    const last24hCount = appointments.filter(a => new Date(a.createdAt || a.date) >= last24h).length;
    const last30dCount = appointments.filter(a => new Date(a.createdAt || a.date) >= last30d).length;
    // Aktif dil (varsayılan tr)
    const lang = req.query.lang || 'tr';
    const appointmentsByDoctor = doctors.map(doc => {
      let doctorName =
        (doc.translations && doc.translations[lang] && doc.translations[lang].name) ||
        (doc.translations && doc.translations['tr'] && doc.translations['tr'].name) ||
        (doc.translations && Object.values(doc.translations)[0]?.name) ||
        'Adı Yok';
      return {
        doctorId: doc.id,
        doctorName,
        count: appointments.filter(a => a.doctorId === doc.id).length
      };
    });
    res.json({
      totalAppointments: total,
      last24hAppointments: last24hCount,
      last30dAppointments: last30dCount,
      doctorCount: doctors.length,
      appointmentsByDoctor,
      memberCount: patients.length
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to calculate stats' });
  }
});

// --- POST (Create) Endpoints ---
app.post('/api/testimonials', (req, res) => {
    const db = readDb();
    const newId = (db.testimonials.length > 0) ? Math.max(...db.testimonials.map(t => t.id)) + 1 : 1;
    const newTestimonial = { ...req.body, id: newId };
    db.testimonials.push(newTestimonial);
    writeDb(db);
    res.status(201).json({ success: true, testimonial: newTestimonial });
});

app.post('/api/appointments', authMiddlewareOptional, async (req, res) => {
  try {
    const appointments = readAppointmentsDb();
    const newId = (appointments.length > 0) ? Math.max(...appointments.map(a => a.id)) + 1 : 1;
    let newAppointment = { ...req.body, id: newId, status: 'pending' };
    if (req.patient && req.patient.id) {
      newAppointment.patientId = req.patient.id;
    }
    appointments.push(newAppointment);
    writeAppointmentsDb(appointments);
    let mailError = null;
    try {
      const localeObj = getLocale(newAppointment.locale || 'tr');
      const site = getSiteConfigSync() || {};
      const logoUrl = site.logoUrl || '';
      const subject = localeObj.appointmentMailCreatedSubject || 'Randevu Talebiniz Alındı';
      const body = (localeObj.appointmentMailCreatedBody || '').replace('{name}', newAppointment.name || '')
        .replace('{date}', newAppointment.date || '').replace('{time}', newAppointment.time || '');
      // Tam HTML şablonunu burada oluştur
      const html = getAppointmentMailTemplate({ contentHtml: body, site, logoUrl });
      await sendMail({
        to: newAppointment.email,
        subject,
        html, // Hazır HTML'i gönder
        locale: newAppointment.locale || 'tr'
      });
    } catch (err) {
      mailError = err && err.message;
      console.error('Randevu oluşturma maili gönderilemedi:', mailError);
    }
    res.status(201).json({ success: true, appointment: newAppointment, mailError });
  } catch (err) {
    console.error('Randevu oluşturma endpoint hatası:', err);
    const lang = req.body?.locale || 'tr';
    const localeObj = getLocale(lang);
    res.status(500).json({ error: localeObj.formError || 'Bir hata oluştu.', detail: err && err.message });
  }
});

app.post('/api/doctors', (req, res) => {
    const db = readDb();
    const newId = (db.doctors.length > 0) ? Math.max(...db.doctors.map(d => d.id)) + 1 : 1;
    const newDoctor = { ...req.body, id: newId };
    db.doctors.push(newDoctor);
    writeDb(db);
    res.status(201).json({ success: true, doctor: newDoctor });
});

app.post('/api/admin-login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        // JWT token üret
        const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

const setupPath = path.join(__dirname, 'new_setup.json');

function getSetupStatus() {
  try {
    const data = fs.readFileSync(setupPath, 'utf-8');
    return JSON.parse(data).isSetupComplete === true;
  } catch {
    return false;
  }
}

function setSetupStatus(val) {
  fs.writeFileSync(setupPath, JSON.stringify({ isSetupComplete: val }, null, 2), 'utf-8');
}

app.get('/api/setup-status', (req, res) => {
  res.json({ isSetupComplete: getSetupStatus() });
});

app.post('/api/setup-complete', (req, res) => {
  setSetupStatus(true);
  res.json({ success: true });
});

app.post('/api/reset', (req, res) => {
  const resetDb = {
    doctors: [], services: [], testimonials: [],
    pageContent: {
      hero: { translations: { tr: { title: 'Mükemmel gülüşünüz burada başlar', subtitle: 'Her hasta için özenli, modern diş hekimliği. Dişlerinizin sağlığı ve güzelliği için tam kapsamlı hizmetler sunuyoruz.' }, en: { title: 'Your perfect smile starts here', subtitle: 'Modern dentistry with care for every patient. We offer a full range of services for your dental health and beauty.' }, de: { title: 'Ihr perfektes Lächeln beginnt hier', subtitle: 'Moderne Zahnmedizin mit Fürsorge für jeden Patienten. Wir bieten ein umfassendes Leistungsspektrum für Ihre Zahngesundheit und Schönheit.' }, es: { title: 'Tu sonrisa perfecta comienza aquí', subtitle: 'Odontología moderna con atención a cada paciente. Ofrecemos una gama completa de servicios para la salud y belleza de tus dientes.' }, fr: { title: 'Votre sourire parfait commence ici', subtitle: 'Dentisterie moderne avec soin pour chaque patient. Nous proposons une gamme complète de services pour la santé et la beauté de vos dents.' }, it: { title: 'Il tuo sorriso perfetto inizia qui', subtitle: 'Odontoiatria moderna con attenzione per ogni paziente. Offriamo una gamma completa di servizi per la salute e la bellezza dei denti.' }, nl: { title: 'Jouw perfecte glimlach begint hier', subtitle: 'Moderne tandheelkunde met zorg voor elke patiënt. Wij bieden een volledig scala aan diensten voor de gezondheid en schoonheid van uw gebit.' }, ru: { title: 'Ваша идеальная улыбка начинается здесь', subtitle: 'Современная стоматология с заботой о каждом пациенте. Мы предлагаем полный спектр услуг для здоровья и красоты ваших зубов.' } }, backgroundImageUrl: '' },
      about: { translations: { tr: { title: 'Hakkımızda', p1: '', p2: '' }, en: { title: 'About Us', p1: '', p2: '' }, de: { title: 'Über uns', p1: '', p2: '' }, es: { title: 'Sobre nosotros', p1: '', p2: '' }, fr: { title: 'À propos de nous', p1: '', p2: '' }, it: { title: 'Chi siamo', p1: '', p2: '' }, nl: { title: 'Over ons', p1: '', p2: '' }, ru: { title: 'О нашей клинике', p1: '', p2: '' } }, imageUrl: '' }
    }
  };
  fs.writeFileSync(path.join(__dirname, 'db.json'), JSON.stringify(resetDb, null, 2), 'utf-8');
  fs.writeFileSync(path.join(__dirname, 'appointments.json'), JSON.stringify([], null, 2), 'utf-8');
  fs.writeFileSync(path.join(__dirname, 'patients.json'), JSON.stringify([], null, 2), 'utf-8');
  res.json({ success: true });
});

// --- DELETE Endpoints ---
app.delete('/api/testimonials/:id', (req, res) => {
    const db = readDb();
    const id = parseInt(req.params.id, 10);
    const initialLength = db.testimonials.length;
    db.testimonials = db.testimonials.filter(t => t.id !== id);
    if (db.testimonials.length < initialLength) {
        writeDb(db);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: 'Testimonial not found' });
    }
});

app.delete('/api/appointments/:id', (req, res) => {
    let appointments = readAppointmentsDb();
    const id = parseInt(req.params.id, 10);
    const initialLength = appointments.length;
    appointments = appointments.filter(a => a.id !== id);
    if (appointments.length < initialLength) {
        writeAppointmentsDb(appointments);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: 'Appointment not found' });
    }
});

app.delete('/api/doctors/:id', (req, res) => {
    const db = readDb();
    const id = parseInt(req.params.id, 10);
    const initialLength = db.doctors.length;
    const doctorToDelete = db.doctors.find(d => d.id === id);

    if (doctorToDelete) {
        db.doctors = db.doctors.filter(d => d.id !== id);
        let appointments = readAppointmentsDb();
        appointments = appointments.filter(app => String(app.doctorId) !== String(id));
        writeAppointmentsDb(appointments);
        writeDb(db);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: 'Doctor not found' });
    }
});

// --- PUT/UPDATE Endpoints ---
app.put('/api/testimonials/:id', (req, res) => {
    const db = readDb();
    const id = parseInt(req.params.id, 10);
    const index = db.testimonials.findIndex(t => t.id === id);
    if (index !== -1) {
        db.testimonials[index] = { ...db.testimonials[index], ...req.body };
        writeDb(db);
        res.json({ success: true, testimonial: db.testimonials[index] });
    } else {
        res.status(404).json({ success: false, message: 'Testimonial not found' });
    }
});

app.put('/api/doctors/:id', (req, res) => {
    const db = readDb();
    const id = parseInt(req.params.id, 10);
    const index = db.doctors.findIndex(d => d.id === id);
    if (index !== -1) {
        db.doctors[index] = req.body;
        writeDb(db);
        res.json({ success: true, doctor: db.doctors[index] });
    } else {
        res.status(404).json({ success: false, message: 'Doctor not found' });
    }
});

app.put('/api/site-config', (req, res) => {
    const db = readDb();
    const newConfig = req.body;
    if (newConfig.seo) {
        db.seo = { ...db.seo, ...newConfig.seo };
        delete newConfig.seo;
    }
    db.siteConfig = { ...db.siteConfig, ...newConfig };
    writeDb(db);
    res.json({ success: true, config: db.siteConfig });
});

app.put('/api/page-content', (req, res) => {
    const db = readDb();
    db.pageContent = { ...db.pageContent, ...req.body };
    writeDb(db);
    res.json({ success: true, content: db.pageContent });
});

app.put('/api/services/:id', (req, res) => {
    const db = readDb();
    const id = parseInt(req.params.id, 10);
    const index = db.services.findIndex(s => s.id === id);
    if (index !== -1) {
        db.services[index].title = req.body.title;
        db.services[index].description = req.body.description;
        writeDb(db);
        res.json({ success: true, service: db.services[index] });
    } else {
        res.status(404).json({ success: false, message: 'Service not found' });
    }
});

app.put('/api/appointments/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    let appointments = readAppointmentsDb();
    const idx = appointments.findIndex(a => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const prevStatus = appointments[idx].status;
    const { status } = req.body;
    appointments[idx] = { ...appointments[idx], ...req.body };
    writeAppointmentsDb(appointments);
    let mailError = null;
    if ((status === 'approved' || status === 'rejected') && status !== prevStatus) {
      const appt = appointments[idx];
      try {
        const localeObj = getLocale(appt.locale || 'tr');
        const site = getSiteConfigSync() || {};
        const logoUrl = site.logoUrl || '';
        let subject = '';
        let body = '';
        if (status === 'approved') {
          subject = localeObj.appointmentMailApprovedSubject || 'Randevunuz Onaylandı';
          body = (localeObj.appointmentMailApprovedBody || '').replace('{name}', appt.name || '')
            .replace('{date}', appt.date || '').replace('{time}', appt.time || '');
        } else if (status === 'rejected') {
          subject = localeObj.appointmentMailRejectedSubject || 'Randevunuz Reddedildi';
          body = (localeObj.appointmentMailRejectedBody || '').replace('{name}', appt.name || '')
            .replace('{date}', appt.date || '').replace('{time}', appt.time || '');
        }
        
        // Tam HTML şablonunu burada oluştur
        const html = getAppointmentMailTemplate({ contentHtml: body, site, logoUrl });

        await sendMail({
          to: appt.email,
          subject,
          html, // Hazır HTML'i gönder
          locale: appt.locale || 'tr'
        });
      } catch (err) {
        mailError = err && err.message;
        console.error('Randevu durum maili gönderilemedi:', mailError);
      }
    }
    res.json({ success: true, appointment: appointments[idx], mailError });
  } catch (err) {
    console.error('Randevu güncelleme endpoint hatası:', err);
    const lang = req.body?.locale || 'tr';
    const localeObj = getLocale(lang);
    res.status(500).json({ error: localeObj.formError || 'Bir hata oluştu.', detail: err && err.message });
  }
});

// --- File Upload Endpoint ---
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ success: true, url: fileUrl });
});

// SMTP settings
const defaultSmtpPath = path.join(__dirname, 'smtp.json');
app.get('/api/smtp-settings', (req, res) => {
  try {
    const smtpData = fs.readFileSync(defaultSmtpPath, 'utf-8');
    res.json(JSON.parse(smtpData));
  } catch (err) {
    res.status(500).json({ error: 'SMTP ayarları okunamadı.' });
  }
});
app.post('/api/smtp-settings', (req, res) => {
  try {
    fs.writeFileSync(defaultSmtpPath, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'SMTP ayarları kaydedilemedi.' });
  }
});
function getSmtpSettingsSync() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'smtp.json'), 'utf-8'));
  } catch {
    return null;
  }
}

// **DÜZELTİLDİ**: Genel mail gönderim fonksiyonu artık şablonu tekrar sarmıyor.
async function sendMail({ to, subject, html, locale = 'tr' }) {
  const smtp = getSmtpSettingsSync();
  if (!smtp || !smtp.host || !smtp.user || !smtp.pass) throw new Error(getLocale(locale).smtpConfigError || 'SMTP ayarları eksik.');
  const site = getSiteConfigSync();
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port),
    secure: !!smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    tls: { rejectUnauthorized: false }
  });
  try {
    await transporter.verify();
    await transporter.sendMail({
      from: `${smtp.fromName || site.name || smtp.user} <${smtp.user}>`,
      to,
      subject,
      html: html // HTML'i olduğu gibi gönderir
    });
  } catch (err) {
    console.error('Mail gönderilemedi:', err);
    throw new Error((err && err.message) || getLocale(locale).smtpSendError || 'Mail gönderilemedi.');
  }
}

// Patient endpoints
app.post('/api/patients/register', async (req, res) => {
  const { name, email, password, phone, locale: userLocale } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  const patients = readPatients();
  if (patients.find(p => p.email === email)) return res.status(409).json({ error: 'Email already exists' });
  const hash = bcrypt.hashSync(password, 10);
  const patient = { id: Date.now(), name, email, password: hash, phone: phone || '', createdAt: new Date().toISOString(), locale: userLocale || 'en' };
  patients.push(patient);
  writePatients(patients);
  const token = jwt.sign({ id: patient.id, email: patient.email }, JWT_SECRET, { expiresIn: '7d' });
  try {
    const localeObj = getLocale(patient.locale);
    const contentHtml = `<div style='text-align:center;font-size:18px;'>${name},<br/>${localeObj.registerSuccessMessage || 'Üyeliğiniz başarıyla oluşturuldu. Klinik sistemimize hoş geldiniz!'}</div>`;
    // **DÜZELTİLDİ**: Genel şablonu burada uygula
    const html = getMailTemplate(contentHtml);
    await sendMail({
      to: email,
      subject: localeObj.registerTitle || 'Üyeliğiniz Oluşturuldu',
      html, // Hazır HTML'i gönder
      locale: patient.locale
    });
  } catch (err) {
    console.error('Kayıt maili gönderilemedi:', err.message);
    // Mail hatası kullanıcıya token döndürmeyi engellememeli
  }
  res.json({ token, patient: { id: patient.id, name: patient.name, email: patient.email, phone: patient.phone } });
});
app.post('/api/patients/login', (req, res) => {
  const { email, password } = req.body;
  const patients = readPatients();
  const patient = patients.find(p => p.email === email);
  if (!patient || !bcrypt.compareSync(password, patient.password)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: patient.id, email: patient.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, patient: { id: patient.id, name: patient.name, email: patient.email, phone: patient.phone } });
});
app.get('/api/patients/me', authMiddleware, (req, res) => {
  const patients = readPatients();
  const patient = patients.find(p => p.id === req.patient.id);
  if (!patient) return res.status(404).json({ error: 'Not found' });
  res.json({ id: patient.id, name: patient.name, email: patient.email, phone: patient.phone });
});
app.put('/api/patients/me', authMiddleware, (req, res) => {
  const { name, phone } = req.body;
  const patients = readPatients();
  const idx = patients.findIndex(p => p.id === req.patient.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  if (name) patients[idx].name = name;
  if (phone) patients[idx].phone = phone;
  writePatients(patients);
  res.json({ id: patients[idx].id, name: patients[idx].name, email: patients[idx].email, phone: patients[idx].phone });
});
app.get('/api/patients/appointments', authMiddleware, (req, res) => {
  const appointments = JSON.parse(fs.readFileSync(path.join(__dirname, 'appointments.json'), 'utf-8'));
  const myApps = appointments.filter(a => String(a.patientId) === String(req.patient.id));
  res.json(myApps);
});
app.delete('/api/patients/appointments/:id', authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  let appointments = JSON.parse(fs.readFileSync(path.join(__dirname, 'appointments.json'), 'utf-8'));
  const idx = appointments.findIndex(a => a.id === id && a.patientId === req.patient.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  appointments.splice(idx, 1);
  fs.writeFileSync(path.join(__dirname, 'appointments.json'), JSON.stringify(appointments, null, 2), 'utf-8');
  res.json({ success: true });
});
app.get('/api/patients', (req, res) => {
  const patients = readPatients();
  res.json(patients.map(p => ({ id: p.id, name: p.name, email: p.email, phone: p.phone, createdAt: p.createdAt })));
});
app.delete('/api/patients/:id', (req, res) => {
  const id = Number(req.params.id);
  let patients = readPatients();
  const idx = patients.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  patients.splice(idx, 1);
  writePatients(patients);
  res.json({ success: true });
});
app.put('/api/patients/:id', (req, res) => {
  const id = Number(req.params.id);
  let patients = readPatients();
  const idx = patients.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const { name, phone } = req.body;
  if (name) patients[idx].name = name;
  if (phone) patients[idx].phone = phone;
  writePatients(patients);
  res.json({ id: patients[idx].id, name: patients[idx].name, email: patients[idx].email, phone: patients[idx].phone, createdAt: patients[idx].createdAt });
});

function getSiteConfigSync() {
  try {
    const config = fs.readFileSync(path.join(__dirname, 'db.json'), 'utf-8');
    return JSON.parse(config)?.siteConfig || {};
  } catch {
    return {};
  }
}

// Helper: Genel mail şablonu (kayıt, smtp test gibi durumlar için)
function getMailTemplate(contentHtml) {
  const site = getSiteConfigSync();
  const logoUrl = site.logoUrl || '';
  const siteName = site.name || '';
  const instagram = site.instagram || '';
  const address = site.address || '';
  const phone = site.phone || '';
  const email = site.email || '';
  return `
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px #0001;font-family:sans-serif;">
    <div style="background:#f8fafc;padding:32px 24px 16px 24px;text-align:center;">
      ${logoUrl ? `<img src="${logoUrl}" alt="Logo" style="max-width:160px;max-height:80px;margin-bottom:8px;" />` : ''}
      <div style="font-size:22px;font-weight:700;color:#222;margin-bottom:4px;">${siteName}</div>
    </div>
    <div style="padding:32px 24px 24px 24px;font-size:16px;color:#222;line-height:1.7;">
      ${contentHtml}
    </div>
    <div style="background:#f1f5f9;padding:20px 24px 16px 24px;font-size:13px;color:#555;text-align:center;">
      ${instagram ? `<div style='margin-bottom:4px;'><b>Instagram:</b> <a href="${instagram}" style="color:#4f8cff;text-decoration:none;">${instagram.replace('https://instagram.com/','').replace('https://www.instagram.com/','').replace('@','')}</a></div>` : ''}
      ${address ? `<div style='margin-bottom:4px;'><b>${site.locale?.clinicAddressLabel || 'Adres'}:</b> ${address}</div>` : ''}
      ${phone ? `<div style='margin-bottom:4px;'><b>${site.locale?.phoneSettingsLabel || 'Telefon'}:</b> ${phone}</div>` : ''}
      ${email ? `<div><b>${site.locale?.emailSettingsLabel || 'E-posta'}:</b> ${email}</div>` : ''}
    </div>
  </div>
  `;
}

// **DÜZELTİLDİ**: Randevu mail şablonu artık tek ve tutarlı.
function getAppointmentMailTemplate({ contentHtml, site, logoUrl }) {
  return `
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px #0001;font-family:sans-serif;">
    <div style="padding:32px 24px 16px 24px;text-align:center;">
      ${logoUrl ? `<img src="${logoUrl}" alt="${site.name || 'Logo'}" style="max-width:120px;max-height:60px;margin:0 auto 12px auto;display:block;" />` : ''}
      <div style="font-size:22px;font-weight:700;color:#222;margin-bottom:0;">${site.name || ''}</div>
    </div>
    <div style="padding:0 24px 24px 24px;font-size:16px;color:#222;line-height:1.7;text-align:left;">
      ${contentHtml}
      <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;font-size:14px;color:#555;">
        ${site.address ? `<div style='margin-bottom:4px;'><b>Adres:</b> ${site.address}</div>` : ''}
        ${site.phone ? `<div style='margin-bottom:4px;'><b>Telefon:</b> <a href='tel:${site.phone}' style='color:#2563eb;text-decoration:none;'>${site.phone}</a></div>` : ''}
        ${site.email ? `<div><b>E-posta:</b> <a href='mailto:${site.email}' style='color:#2563eb;text-decoration:none;'>${site.email}</a></div>` : ''}
      </div>
    </div>
  </div>
  `;
}

// SMTP test endpoint
app.post('/api/smtp-test', async (req, res) => {
  try {
    const smtp = req.body;
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: Number(smtp.port),
      secure: !!smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
      tls: { rejectUnauthorized: false }
    });
    await transporter.verify();
    
    const contentHtml = '<div style="text-align:center;font-size:18px;">Test maili başarılı!<br/>Bu bir deneme e-postasıdır.</div>';
    // **DÜZELTİLDİ**: Genel şablonu burada uygula
    const html = getMailTemplate(contentHtml);

    await transporter.sendMail({
      from: `${smtp.fromName || 'Test' } <${smtp.user}>`,
      to: smtp.testEmail || smtp.user,
      subject: 'Test Mail',
      html
    });
    res.json({ success: true });
  } catch (err) {
    const lang = req.body.locale || 'tr';
    const localeObj = getLocale(lang);
    console.error('SMTP test mail gönderilemedi:', err);
    res.status(500).json({ error: localeObj.smtpTestError || 'Test maili gönderilemedi.', detail: err && err.message });
  }
});

// Locale dosyalarını oku
const locales = {
  tr: require('./src/locales/tr.cjs').tr,
  en: require('./src/locales/en.cjs').en,
  ru: require('./src/locales/ru.cjs').ru,
  de: require('./src/locales/de.cjs').de,
  es: require('./src/locales/es.cjs').es,
  fr: require('./src/locales/fr.cjs').fr,
  it: require('./src/locales/it.cjs').it,
  nl: require('./src/locales/nl.cjs').nl,
};
function getLocale(lang) {
  return locales[lang] || locales['en'];
}

const GALLERY_PATH = path.join(__dirname, 'after_before.json');
function readGallery() {
  try {
    return JSON.parse(fs.readFileSync(GALLERY_PATH, 'utf-8'));
  } catch {
    return [];
  }
}
function writeGallery(data) {
  fs.writeFileSync(GALLERY_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// --- Galeri/Öncesi-Sonrası API ---
// Tüm galerileri getir
app.get('/api/gallery', (req, res) => {
  res.json(readGallery());
});
// Galeri ekle
app.post('/api/gallery', (req, res) => {
  const gallery = readGallery();
  const newId = gallery.length > 0 ? Math.max(...gallery.map(g => g.id)) + 1 : 1;
  const newItem = { ...req.body, id: newId };
  gallery.push(newItem);
  writeGallery(gallery);
  res.status(201).json({ success: true, item: newItem });
});
// Galeri güncelle
app.put('/api/gallery/:id', (req, res) => {
  const gallery = readGallery();
  const id = Number(req.params.id);
  const idx = gallery.findIndex(g => g.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  gallery[idx] = { ...gallery[idx], ...req.body };
  writeGallery(gallery);
  res.json({ success: true, item: gallery[idx] });
});
// Galeri sil
app.delete('/api/gallery/:id', (req, res) => {
  let gallery = readGallery();
  const id = Number(req.params.id);
  const initialLength = gallery.length;
  gallery = gallery.filter(g => g.id !== id);
  if (gallery.length < initialLength) {
    writeGallery(gallery);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

const GOOGLE_REVIEWS_PATH = path.join(__dirname, 'google_reviews.json');
function readGoogleReviews() {
  try {
    return JSON.parse(fs.readFileSync(GOOGLE_REVIEWS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}
function writeGoogleReviews(reviews) {
  fs.writeFileSync(GOOGLE_REVIEWS_PATH, JSON.stringify(reviews, null, 2), 'utf-8');
}

const GOOGLE_CONFIG_PATH = path.join(__dirname, 'google_config.json');
function readGoogleConfig() {
  try {
    return JSON.parse(fs.readFileSync(GOOGLE_CONFIG_PATH, 'utf-8'));
  } catch {
    return { apiKey: '', placeId: '', visible: true };
  }
}
function writeGoogleConfig(config) {
  fs.writeFileSync(GOOGLE_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

// Google Reviews'ı Google Places API'dan çekip kaydeden fonksiyon
async function fetchGoogleReviewsFromAPI() {
  const config = readGoogleConfig();
  const GOOGLE_PLACE_ID = config.placeId || 'YOUR_PLACE_ID';
  const GOOGLE_API_KEY = config.apiKey || 'YOUR_API_KEY';
  if (!GOOGLE_PLACE_ID || !GOOGLE_API_KEY) throw new Error('Google API anahtarı veya Place ID eksik');
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${GOOGLE_PLACE_ID}&fields=reviews&key=${GOOGLE_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.result || !Array.isArray(data.result.reviews)) return [];
  // Mevcut yorumları oku
  const existing = readGoogleReviews();
  const existingById = Object.fromEntries(existing.map(r => [r.reviewId || r.id, r]));
  const newReviews = data.result.reviews.map((g, idx) => {
    // Google reviewId benzersizdir
    const reviewId = g.review_id;
    // Çok dilli çeviri için sadece orijinal dilde doldur
    const tr = {
      author: g.author_name,
      text: g.text,
      rating: g.rating,
    };
    const en = tr; // İsterseniz çeviri API ile çevrilebilir
    const base = {
      reviewId,
      translations: { tr, en },
      date: g.time ? new Date(g.time * 1000).toISOString() : '',
      profilePhotoUrl: g.profile_photo_url,
      reviewUrl: g.author_url,
      visible: true
    };
    // Eğer daha önce eklenmişse, eski çevirileri/görünürlük ayarını koru
    if (existingById[reviewId]) {
      return { ...base, ...existingById[reviewId], translations: { ...base.translations, ...existingById[reviewId].translations } };
    }
    return base;
  });
  // Var olan ve Google'dan gelmeyen (manuel eklenen) yorumları da koru
  const manualReviews = existing.filter(r => !r.reviewId);
  const all = [...manualReviews, ...newReviews];
  writeGoogleReviews(all);
  return all;
}

// --- Google Reviews API ---
// Herkes erişebilir
app.get('/api/google-reviews', (req, res) => {
  res.json(readGoogleReviews());
});
// Sadece admin (token ile)
function adminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
    if (payload.role !== 'admin') throw new Error('Not admin');
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
app.post('/api/google-reviews', adminAuth, (req, res) => {
  const reviews = readGoogleReviews();
  const newId = (reviews.length > 0) ? Math.max(...reviews.map(r => r.id)) + 1 : 1;
  const newReview = { ...req.body, id: newId };
  reviews.push(newReview);
  writeGoogleReviews(reviews);
  res.status(201).json({ success: true, review: newReview });
});
app.put('/api/google-reviews/:id', adminAuth, (req, res) => {
  let reviews = readGoogleReviews();
  const id = Number(req.params.id);
  const idx = reviews.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  reviews[idx] = { ...reviews[idx], ...req.body };
  writeGoogleReviews(reviews);
  res.json({ success: true, review: reviews[idx] });
});
app.delete('/api/google-reviews/:id', adminAuth, (req, res) => {
  let reviews = readGoogleReviews();
  const id = Number(req.params.id);
  const idx = reviews.findIndex(r => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  reviews.splice(idx, 1);
  writeGoogleReviews(reviews);
  res.json({ success: true });
});

// Admin endpoint: Google'dan yorumları çek
app.post('/api/google-reviews/fetch-from-google', adminAuth, async (req, res) => {
  try {
    const reviews = await fetchGoogleReviewsFromAPI();
    res.json({ success: true, reviews });
  } catch (e) {
    res.status(500).json({ error: 'Google yorumları çekilemedi', detail: e && e.message });
  }
});

app.get('/api/google-reviews/config', adminAuth, (req, res) => {
  res.json(readGoogleConfig());
});
app.put('/api/google-reviews/config', adminAuth, (req, res) => {
  const { apiKey, placeId, visible } = req.body;
  const config = readGoogleConfig();
  if (typeof apiKey === 'string') config.apiKey = apiKey;
  if (typeof placeId === 'string') config.placeId = placeId;
  if (typeof visible === 'boolean') config.visible = visible;
  writeGoogleConfig(config);
  res.json({ success: true, config });
});

app.listen(PORT, () => {
    console.log(`JSON Server is running on http://localhost:${PORT}`);
});