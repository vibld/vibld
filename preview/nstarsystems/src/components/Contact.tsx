import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { contactDetails } from '../data/content'

interface FormState {
  name: string
  email: string
  company: string
  phone: string
  message: string
}

const emptyForm: FormState = {
  name: '',
  email: '',
  company: '',
  phone: '',
  message: '',
}

export default function Contact() {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [sent, setSent] = useState(false)

  const update =
    (key: keyof FormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((previous) => ({ ...previous, [key]: event.target.value }))
    }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSent(true)
    setForm(emptyForm)
  }

  return (
    <section className="section contact" id="contact">
      <div className="shell contact__grid">
        <div className="contact-card" data-reveal>
          <p className="eyebrow">
            <span className="eyebrow__dot" />
            Start a conversation
          </p>
          <h2 className="section__title">Tell us what is keeping you up at night.</h2>
          <p className="section__lede">
            Send a note and a senior engineer — not a sales development representative — will
            respond within one business day.
          </p>

          {sent ? (
            <div className="form__success" role="status">
              <strong>Thank you — your message has been recorded.</strong>
              <p>
                This is a demonstration site, so nothing was actually transmitted or stored. In a
                live deployment you would hear back within one business day.
              </p>
            </div>
          ) : (
            <form className="form" onSubmit={handleSubmit} noValidate={false}>
              <div className="form__row">
                <label className="field">
                  <span className="field__label">Name</span>
                  <input
                    className="field__input"
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={update('name')}
                    placeholder="Jordan Reyes"
                    required
                  />
                </label>

                <label className="field">
                  <span className="field__label">Email</span>
                  <input
                    className="field__input"
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={update('email')}
                    placeholder="jordan@company.com"
                    required
                  />
                </label>
              </div>

              <div className="form__row">
                <label className="field">
                  <span className="field__label">Company</span>
                  <input
                    className="field__input"
                    type="text"
                    name="company"
                    value={form.company}
                    onChange={update('company')}
                    placeholder="Company name"
                  />
                </label>

                <label className="field">
                  <span className="field__label">Phone</span>
                  <input
                    className="field__input"
                    type="tel"
                    name="phone"
                    value={form.phone}
                    onChange={update('phone')}
                    placeholder="(508) 555-0142"
                  />
                </label>
              </div>

              <label className="field field--full">
                <span className="field__label">How can we help?</span>
                <textarea
                  className="field__input field__input--area"
                  name="message"
                  rows={5}
                  value={form.message}
                  onChange={update('message')}
                  placeholder="We have three sites on aging firewalls and an audit in September."
                  required
                />
              </label>

              <button className="btn btn--primary form__submit" type="submit">
                Send Message
              </button>

              <p className="form__note">
                Demonstration notice: this form does not send, transmit or store any data. Nothing
                leaves your browser.
              </p>
            </form>
          )}
        </div>

        <aside className="contact__aside" data-reveal>
          <h3 className="contact__aside-title">Reach us directly</h3>
          <dl className="contact-detail">
            {contactDetails.map((detail) => (
              <div className="contact-detail__row" key={detail.label}>
                <dt className="contact-detail__label">{detail.label}</dt>
                <dd className="contact-detail__value">
                  {detail.href ? <a href={detail.href}>{detail.value}</a> : detail.value}
                </dd>
              </div>
            ))}
          </dl>

          <p className="contact__aside-note">
            Demonstration notice: the contact details above are illustrative for this preview and
            are not monitored.
          </p>
        </aside>
      </div>
    </section>
  )
}
