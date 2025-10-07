FROM node:18

# Install Git
RUN apt-get update && apt-get install -y git

# Configure Git identity
RUN git config --global user.email "builder@railway.app" && git config --global user.name "Railway Builder"

# Set work directory
WORKDIR /app

# Copy files
COPY . .

# Install dependencies
RUN npm install

# Expose port
EXPOSE 8080

# Start your app
CMD ["npm", "start"]
